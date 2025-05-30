import { CDNSettings } from '../../browser'
import { JSONObject, JSONValue } from '../../core/events'
import { Plugin, InternalPluginWithAddMiddleware } from '../../core/plugin'
import { loadScript } from '../../lib/load-script'
import { getCDN } from '../../lib/parse-cdn'
import {
  applyDestinationMiddleware,
  DestinationMiddlewareFunction,
} from '../middleware'
import { Context, ContextCancelation } from '../../core/context'
import { recordIntegrationMetric } from '../../core/stats/metric-helpers'
import { Analytics, InitOptions } from '../../core/analytics'
import { createDeferred } from '@segment/analytics-generic-utils'
import { IntegrationsInitOptions } from '../../browser/settings'

export interface RemotePlugin {
  /** The name of the remote plugin */
  name: string
  /** The creation name of the remote plugin */
  creationName: string
  /** The url of the javascript file to load */
  url: string
  /** The UMD/global name the plugin uses. Plugins are expected to exist here with the `PluginFactory` method signature */
  libraryName: string
  /** The settings related to this plugin. */
  settings: JSONObject
}

export class ActionDestination implements InternalPluginWithAddMiddleware {
  name: string // destination name
  version = '1.0.0'
  /**
   * The lifecycle name of the wrapped plugin.
   * This does not need to be 'destination', and can be 'enrichment', etc.
   */
  type: Plugin['type']

  alternativeNames: string[] = []

  private loadPromise = createDeferred<unknown>()

  middleware: DestinationMiddlewareFunction[] = []

  action: Plugin

  constructor(name: string, action: Plugin) {
    this.action = action
    this.name = name
    this.type = action.type
    this.alternativeNames.push(action.name)
  }

  addMiddleware(...fn: DestinationMiddlewareFunction[]): void {
    /** Make sure we only apply destination filters to actions of the "destination" type to avoid causing issues for hybrid destinations */
    if (this.type === 'destination') {
      this.middleware.push(...fn)
    }
  }

  private async transform(ctx: Context): Promise<Context> {
    const modifiedEvent = await applyDestinationMiddleware(
      this.name,
      ctx.event,
      this.middleware
    )

    if (modifiedEvent === null) {
      ctx.cancel(
        new ContextCancelation({
          retry: false,
          reason: 'dropped by destination middleware',
        })
      )
    }

    return new Context(modifiedEvent!)
  }

  private _createMethod(
    methodName: 'track' | 'page' | 'identify' | 'alias' | 'group' | 'screen'
  ) {
    return async (ctx: Context): Promise<Context> => {
      if (!this.action[methodName]) return ctx

      let transformedContext: Context = ctx
      // Transformations only allowed for destination plugins. Other plugin types support mutating events.
      if (this.type === 'destination') {
        transformedContext = await this.transform(ctx)
      }

      try {
        if (!(await this.ready())) {
          throw new Error(
            'Something prevented the destination from getting ready'
          )
        }

        recordIntegrationMetric(ctx, {
          integrationName: this.action.name,
          methodName,
          type: 'action',
        })

        await this.action[methodName]!(transformedContext)
      } catch (error) {
        recordIntegrationMetric(ctx, {
          integrationName: this.action.name,
          methodName,
          type: 'action',
          didError: true,
        })
        throw error
      }

      return ctx
    }
  }

  alias = this._createMethod('alias')
  group = this._createMethod('group')
  identify = this._createMethod('identify')
  page = this._createMethod('page')
  screen = this._createMethod('screen')
  track = this._createMethod('track')

  /* --- PASSTHROUGH METHODS --- */
  isLoaded(): boolean {
    return this.action.isLoaded()
  }

  async ready(): Promise<boolean> {
    try {
      await this.loadPromise.promise
      return true
    } catch {
      return false
    }
  }

  async load(ctx: Context, analytics: Analytics): Promise<unknown> {
    if (this.loadPromise.isSettled()) {
      return this.loadPromise.promise
    }

    try {
      recordIntegrationMetric(ctx, {
        integrationName: this.action.name,
        methodName: 'load',
        type: 'action',
      })

      const loadP = this.action.load(ctx, analytics)

      this.loadPromise.resolve(await loadP)
      return loadP
    } catch (error) {
      recordIntegrationMetric(ctx, {
        integrationName: this.action.name,
        methodName: 'load',
        type: 'action',
        didError: true,
      })

      this.loadPromise.reject(error)
      throw error
    }
  }

  unload(ctx: Context, analytics: Analytics): Promise<unknown> | unknown {
    return this.action.unload?.(ctx, analytics)
  }
}

export type PluginFactory = {
  (settings: JSONValue): Plugin | Plugin[] | Promise<Plugin | Plugin[]>
  pluginName: string
}

function validate(pluginLike: unknown): pluginLike is Plugin[] {
  if (!Array.isArray(pluginLike)) {
    throw new Error('Not a valid list of plugins')
  }

  const required = ['load', 'isLoaded', 'name', 'version', 'type']
  pluginLike.forEach((plugin) => {
    required.forEach((method) => {
      if (plugin[method] === undefined) {
        throw new Error(
          `Plugin: ${
            plugin.name ?? 'unknown'
          } missing required function ${method}`
        )
      }
    })
  })

  return true
}

function isPluginDisabled(
  userIntegrations: IntegrationsInitOptions,
  remotePlugin: RemotePlugin
) {
  const creationNameEnabled = userIntegrations[remotePlugin.creationName]
  const currentNameEnabled = userIntegrations[remotePlugin.name]

  // Check that the plugin isn't explicitly enabled when All: false
  if (
    userIntegrations.All === false &&
    !creationNameEnabled &&
    !currentNameEnabled
  ) {
    return true
  }

  // Check that the plugin isn't explicitly disabled
  if (creationNameEnabled === false || currentNameEnabled === false) {
    return true
  }

  return false
}

async function loadPluginFactory(
  remotePlugin: RemotePlugin,
  options?: { obfuscate?: boolean; nonce?: string }
): Promise<void | PluginFactory> {
  try {
    const defaultCdn = new RegExp('https://cdn.segment.(com|build)')
    const cdn = getCDN()
    const nonceAttr = options?.nonce ? { nonce: options.nonce } : undefined

    if (options?.obfuscate) {
      const urlSplit = remotePlugin.url.split('/')
      const name = urlSplit[urlSplit.length - 2]
      const obfuscatedURL = remotePlugin.url.replace(
        name,
        btoa(name).replace(/=/g, '')
      )
      try {
        await loadScript(obfuscatedURL.replace(defaultCdn, cdn))
      } catch (error) {
        // Due to syncing concerns it is possible that the obfuscated action destination (or requested version) might not exist.
        // We should use the unobfuscated version as a fallback.
        await loadScript(remotePlugin.url.replace(defaultCdn, cdn), nonceAttr)
      }
    } else {
      await loadScript(remotePlugin.url.replace(defaultCdn, cdn), nonceAttr)
    }

    // @ts-expect-error
    if (typeof window[remotePlugin.libraryName] === 'function') {
      // @ts-expect-error
      return window[remotePlugin.libraryName] as PluginFactory
    }
  } catch (err) {
    console.error('Failed to create PluginFactory', remotePlugin)
    throw err
  }
}

export async function remoteLoader(
  settings: CDNSettings,
  integrations: IntegrationsInitOptions,
  mergedIntegrations: Record<string, JSONObject>,
  options?: InitOptions,
  routingMiddleware?: DestinationMiddlewareFunction,
  pluginSources?: PluginFactory[]
): Promise<Plugin[]> {
  const allPlugins: Plugin[] = []

  const routingRules = settings.middlewareSettings?.routingRules ?? []

  const pluginPromises = (settings.remotePlugins ?? []).map(
    async (remotePlugin) => {
      if (isPluginDisabled(integrations, remotePlugin)) return

      try {
        const pluginFactory =
          pluginSources?.find(
            ({ pluginName }) => pluginName === remotePlugin.name
          ) || (await loadPluginFactory(remotePlugin, options))

        if (pluginFactory) {
          const intg = mergedIntegrations[remotePlugin.name]
          const plugin = await pluginFactory({
            ...remotePlugin.settings,
            ...intg,
          })
          const plugins = Array.isArray(plugin) ? plugin : [plugin]

          validate(plugins)

          const routing = routingRules.filter(
            (rule) => rule.destinationName === remotePlugin.creationName
          )

          plugins.forEach((plugin) => {
            const wrapper = new ActionDestination(
              remotePlugin.creationName,
              plugin
            )

            if (routing.length && routingMiddleware) {
              wrapper.addMiddleware(routingMiddleware)
            }

            allPlugins.push(wrapper)
          })
        }
      } catch (error) {
        console.warn('Failed to load Remote Plugin', error)
      }
    }
  )

  await Promise.all(pluginPromises)
  return allPlugins.filter(Boolean)
}
