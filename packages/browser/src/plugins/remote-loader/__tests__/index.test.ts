import braze from '@segment/analytics-browser-actions-braze'

import * as loader from '../../../lib/load-script'
import { ActionDestination, PluginFactory, remoteLoader } from '..'
import { AnalyticsBrowser, CDNSettings } from '../../../browser'
import { InitOptions } from '../../../core/analytics'
import { Context } from '../../../core/context'
import { tsubMiddleware } from '../../routing-middleware'
import { cdnSettingsMinimal } from '../../../test-helpers/fixtures'

const pluginFactory = jest.fn()

describe('Remote Loader', () => {
  const window = global.window as any

  beforeEach(() => {
    jest.resetAllMocks()
    jest.spyOn(console, 'warn').mockImplementation()

    // @ts-expect-error skipping the actual script injection part
    jest.spyOn(loader, 'loadScript').mockImplementation(() => {
      window.testPlugin = pluginFactory
      return Promise.resolve(true)
    })
  })

  it('should attempt to load a script from the url of each remotePlugin', async () => {
    await remoteLoader(
      {
        ...cdnSettingsMinimal,
        remotePlugins: [
          {
            name: 'remote plugin',
            creationName: 'remote plugin',
            url: 'cdn/path/to/file.js',
            libraryName: 'testPlugin',
            settings: {},
          },
        ],
      },
      {},
      {}
    )

    expect(loader.loadScript).toHaveBeenCalledWith(
      'cdn/path/to/file.js',
      undefined
    )
  })

  it('should attempt to load a script from the obfuscated url of each remotePlugin', async () => {
    await remoteLoader(
      {
        integrations: cdnSettingsMinimal.integrations,
        remotePlugins: [
          {
            name: 'remote plugin',
            creationName: 'remote plugin',
            url: 'cdn/path/to/file.js',
            libraryName: 'testPlugin',
            settings: {},
          },
        ],
      },
      {},
      {},
      { obfuscate: true }
    )
    const btoaName = btoa('to').replace(/=/g, '')
    expect(loader.loadScript).toHaveBeenCalledWith(
      `cdn/path/${btoaName}/file.js`
    )
  })

  it('should pass the nonce attribute for each remotePlugin load', async () => {
    await remoteLoader(
      {
        ...cdnSettingsMinimal,
        remotePlugins: [
          {
            name: 'remote plugin',
            creationName: 'remote plugin',
            url: 'cdn/path/to/file.js',
            libraryName: 'testPlugin',
            settings: {},
          },
        ],
      },
      {},
      {},
      { nonce: 'my-foo-nonce' }
    )

    expect(loader.loadScript).toHaveBeenCalledWith('cdn/path/to/file.js', {
      nonce: 'my-foo-nonce',
    })
  })

  it('should attempt to load a script from a custom CDN', async () => {
    window.analytics = {}
    window.analytics._cdn = 'foo.com'
    await remoteLoader(
      {
        ...cdnSettingsMinimal,
        remotePlugins: [
          {
            name: 'remote plugin',
            creationName: 'remote plugin',
            url: 'https://cdn.segment.com/actions/file.js',
            libraryName: 'testPlugin',
            settings: {},
          },
        ],
      },
      {},
      {}
    )

    expect(loader.loadScript).toHaveBeenCalledWith(
      'foo.com/actions/file.js',
      undefined
    )
  })

  it('should work if the cdn is staging', async () => {
    const stagingURL = 'https://cdn.segment.build/actions/foo.js'

    window.analytics = {}
    window.analytics._cdn = 'foo.com'
    await remoteLoader(
      {
        ...cdnSettingsMinimal,
        remotePlugins: [
          {
            name: 'remote plugin',
            creationName: 'remote plugin',
            url: stagingURL,
            libraryName: 'testPlugin',
            settings: {},
          },
        ],
      },
      {},
      {}
    )

    expect(loader.loadScript).toHaveBeenCalledWith(
      'foo.com/actions/foo.js',
      undefined
    )
  })

  it('should attempt calling the library', async () => {
    await remoteLoader(
      {
        ...cdnSettingsMinimal,
        remotePlugins: [
          {
            name: 'remote plugin',
            creationName: 'remote plugin',
            url: 'cdn/path/to/file.js',
            libraryName: 'testPlugin',
            settings: {
              name: 'Charlie Brown',
            },
          },
        ],
      },
      {},
      {}
    )

    expect(pluginFactory).toHaveBeenCalledTimes(1)
    expect(pluginFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Charlie Brown',
      })
    )
  })

  it('should load from given plugin sources before loading from CDN', async () => {
    const brazeSpy = jest.spyOn({ braze }, 'braze')
    ;(brazeSpy as any).pluginName = braze.pluginName

    await remoteLoader(
      {
        ...cdnSettingsMinimal,
        remotePlugins: [
          {
            name: 'Braze Web Mode (Actions)',
            creationName: 'Braze Web Mode (Actions)',
            libraryName: 'brazeDestination',
            url: 'https://cdn.segment.com/next-integrations/actions/braze/a6f95f5869852b848386.js',
            settings: {
              api_key: 'test-api-key',
              versionSettings: {
                componentTypes: [],
              },
              subscriptions: [
                {
                  id: '3thVuvYKBcEGKEZA185Tbs',
                  name: 'Track Calls',
                  enabled: true,
                  partnerAction: 'trackEvent',
                  subscribe: 'type = "track" and event != "Order Completed"',
                  mapping: {
                    eventName: {
                      '@path': '$.event',
                    },
                    eventProperties: {
                      '@path': '$.properties',
                    },
                  },
                },
              ],
            },
          },
        ],
      },
      {},
      {},
      undefined,
      undefined,
      [brazeSpy as unknown as PluginFactory]
    )

    expect(brazeSpy).toHaveBeenCalledTimes(1)
    expect(brazeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        api_key: 'test-api-key',
      })
    )
  })

  it('should not load remote plugins when integrations object contains all: false', async () => {
    await remoteLoader(
      {
        ...cdnSettingsMinimal,
        remotePlugins: [
          {
            name: 'remote plugin',
            creationName: 'remote plugin',
            url: 'cdn/path/to/file.js',
            libraryName: 'testPlugin',
            settings: {
              name: 'Charlie Brown',
            },
          },
        ],
      },
      { All: false },
      {}
    )

    expect(pluginFactory).toHaveBeenCalledTimes(0)
  })

  it('should load remote plugins when integrations object contains all: false but plugin: true', async () => {
    await remoteLoader(
      {
        ...cdnSettingsMinimal,
        remotePlugins: [
          {
            name: 'remote plugin',
            creationName: 'remote plugin',
            url: 'cdn/path/to/file.js',
            libraryName: 'testPlugin',
            settings: {
              name: 'Charlie Brown',
            },
          },
        ],
      },
      { All: false, 'remote plugin': true },
      {}
    )

    expect(pluginFactory).toHaveBeenCalledTimes(1)
    expect(pluginFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Charlie Brown',
      })
    )
  })

  it('should load remote plugin when integrations object contains plugin: false', async () => {
    await remoteLoader(
      {
        ...cdnSettingsMinimal,
        remotePlugins: [
          {
            name: 'remote plugin',
            creationName: 'remote plugin',
            url: 'cdn/path/to/file.js',
            libraryName: 'testPlugin',
            settings: {
              name: 'Charlie Brown',
            },
          },
        ],
      },
      { 'remote plugin': false },
      {}
    )

    expect(pluginFactory).toHaveBeenCalledTimes(0)
  })

  it('should skip remote plugins that arent callable functions', async () => {
    const plugins = await remoteLoader(
      {
        ...cdnSettingsMinimal,
        remotePlugins: [
          {
            name: 'remote plugin',
            creationName: 'remote plugin',
            url: 'cdn/path/to/file.js',
            libraryName: 'this wont resolve',
            settings: {},
          },
        ],
      },
      {},
      {}
    )

    expect(pluginFactory).not.toHaveBeenCalled()
    expect(plugins).toHaveLength(0)
  })

  it('should return all plugins resolved remotely', async () => {
    const one = {
      name: 'one',
      version: '1.0.0',
      type: 'before',
      load: () => {},
      isLoaded: () => true,
    }
    const two = {
      name: 'two',
      version: '1.0.0',
      type: 'before',
      load: () => {},
      isLoaded: () => true,
    }
    const three = {
      name: 'three',
      version: '1.0.0',
      type: 'enrichment',
      load: () => {},
      isLoaded: () => true,
    }

    const multiPluginFactory = jest.fn().mockImplementation(() => [one, two])
    const singlePluginFactory = jest.fn().mockImplementation(() => three)

    // @ts-expect-error not gonna return a script tag sorry
    jest.spyOn(loader, 'loadScript').mockImplementation((url: string) => {
      if (url === 'multiple-plugins.js') {
        window['multiple-plugins'] = multiPluginFactory
      } else {
        window['single-plugin'] = singlePluginFactory
      }
      return Promise.resolve(true)
    })

    const plugins = await remoteLoader(
      {
        ...cdnSettingsMinimal,
        remotePlugins: [
          {
            name: 'multiple plugins',
            creationName: 'multiple plugins',
            url: 'multiple-plugins.js',
            libraryName: 'multiple-plugins',
            settings: { foo: true },
          },
          {
            name: 'single plugin',
            creationName: 'single plugin',
            url: 'single-plugin.js',
            libraryName: 'single-plugin',
            settings: { bar: false },
          },
        ],
      },
      {},
      {}
    )

    expect(plugins).toHaveLength(3)
    expect(plugins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: one,
          name: 'multiple plugins',
          version: '1.0.0',
          type: 'before',
          alternativeNames: ['one'],
          middleware: [],
          track: expect.any(Function),
          alias: expect.any(Function),
          group: expect.any(Function),
          identify: expect.any(Function),
          page: expect.any(Function),
          screen: expect.any(Function),
        }),
        expect.objectContaining({
          action: two,
          name: 'multiple plugins',
          version: '1.0.0',
          type: 'before',
          alternativeNames: ['two'],
          middleware: [],
          track: expect.any(Function),
          alias: expect.any(Function),
          group: expect.any(Function),
          identify: expect.any(Function),
          page: expect.any(Function),
          screen: expect.any(Function),
        }),
        expect.objectContaining({
          action: three,
          name: 'single plugin',
          version: '1.0.0',
          type: 'enrichment',
          alternativeNames: ['three'],
          middleware: [],
          track: expect.any(Function),
          alias: expect.any(Function),
          group: expect.any(Function),
          identify: expect.any(Function),
          page: expect.any(Function),
          screen: expect.any(Function),
        }),
      ])
    )
    expect(multiPluginFactory).toHaveBeenCalledWith({ foo: true })
    expect(singlePluginFactory).toHaveBeenCalledWith({ bar: false })
  })

  it('should ignore plugins that fail to initialize', async () => {
    // @ts-expect-error not gonna return a script tag sorry
    jest.spyOn(loader, 'loadScript').mockImplementation((url: string) => {
      window['flaky'] = (): never => {
        throw Error('aaay')
      }

      window['asyncFlaky'] = async (): Promise<never> => {
        throw Error('aaay')
      }

      return Promise.resolve(true)
    })

    const plugins = await remoteLoader(
      {
        ...cdnSettingsMinimal,
        remotePlugins: [
          {
            name: 'flaky plugin',
            creationName: 'flaky plugin',
            url: 'cdn/path/to/flaky.js',
            libraryName: 'flaky',
            settings: {},
          },
          {
            name: 'async flaky plugin',
            creationName: 'async flaky plugin',
            url: 'cdn/path/to/asyncFlaky.js',
            libraryName: 'asyncFlaky',
            settings: {},
          },
        ],
      },
      {},
      {}
    )

    expect(pluginFactory).not.toHaveBeenCalled()
    expect(plugins).toHaveLength(0)
    expect(console.warn).toHaveBeenCalledTimes(2)
  })

  it('ignores invalid plugins', async () => {
    const invalidPlugin = {
      name: 'invalid',
      version: '1.0.0',
    }

    const validPlugin = {
      name: 'valid',
      version: '1.0.0',
      type: 'enrichment',
      load: () => {},
      isLoaded: () => true,
    }

    // @ts-expect-error not gonna return a script tag sorry
    jest.spyOn(loader, 'loadScript').mockImplementation((url: string) => {
      if (url === 'valid') {
        window['valid'] = jest.fn().mockImplementation(() => validPlugin)
      } else {
        window['invalid'] = jest.fn().mockImplementation(() => invalidPlugin)
      }

      return Promise.resolve(true)
    })

    const plugins = await remoteLoader(
      {
        ...cdnSettingsMinimal,
        remotePlugins: [
          {
            name: 'valid plugin',
            creationName: 'valid plugin',
            url: 'valid',
            libraryName: 'valid',
            settings: { foo: true },
          },
          {
            name: 'invalid plugin',
            creationName: 'invalid plugin',
            url: 'invalid',
            libraryName: 'invalid',
            settings: { bar: false },
          },
        ],
      },
      {},
      {}
    )

    expect(plugins).toHaveLength(1)
    expect(plugins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: validPlugin,
          name: 'valid plugin',
          version: '1.0.0',
          type: 'enrichment',
          alternativeNames: ['valid'],
          middleware: [],
          track: expect.any(Function),
          alias: expect.any(Function),
          group: expect.any(Function),
          identify: expect.any(Function),
          page: expect.any(Function),
          screen: expect.any(Function),
        }),
      ])
    )
    expect(console.warn).toHaveBeenCalledTimes(1)
  })

  it('accepts settings overrides from merged integrations', async () => {
    const cdnSettings: CDNSettings = {
      ...cdnSettingsMinimal,
      integrations: {
        ...cdnSettingsMinimal.integrations,
        remotePlugin: {
          name: 'Charlie Brown',
          version: '1.0',
        },
      },
      remotePlugins: [
        {
          name: 'remotePlugin',
          creationName: 'remotePlugin',
          libraryName: 'testPlugin',
          url: 'cdn/path/to/file.js',
          settings: {
            name: 'Charlie Brown',
            version: '1.0',
            subscriptions: [],
          },
        },
      ],
    }

    const userOverrides = {
      remotePlugin: {
        name: 'Chris Radek',
      },
    }

    await remoteLoader(cdnSettings, userOverrides, {
      // @ts-ignore
      remotePlugin: {
        ...cdnSettings.integrations.remotePlugin,
        ...userOverrides.remotePlugin,
      },
    })

    expect(pluginFactory).toHaveBeenCalledTimes(1)
    expect(pluginFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Chris Radek',
        version: '1.0',
        subscriptions: [],
      })
    )
  })

  it('accepts settings overrides from options (AnalyticsBrowser)', async () => {
    const cdnSettings = {
      ...cdnSettingsMinimal,
      integrations: {
        ...cdnSettingsMinimal.integrations,
        remotePlugin: {
          name: 'Charlie Brown',
          version: '1.0',
        },
      },
      remotePlugins: [
        {
          name: 'remotePlugin',
          creationName: 'remotePlugin',
          libraryName: 'testPlugin',
          url: 'cdn/path/to/file.js',
          settings: {
            name: 'Charlie Brown',
            version: '1.0',
            subscriptions: [],
          },
        },
      ],
    }

    const initOptions: InitOptions = {
      integrations: {
        remotePlugin: {
          name: 'Chris Radek',
        },
      },
    }

    await AnalyticsBrowser.load(
      {
        writeKey: 'key',
        cdnSettings,
      },
      initOptions
    )

    expect(pluginFactory).toHaveBeenCalledTimes(1)
    expect(pluginFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Chris Radek',
        version: '1.0',
        subscriptions: [],
      })
    )
  })

  // Action destinations should be toggled using the `integration` name which matches the `creationName`
  // Most action destinations have the same value for creationName and name, but a few (Amplitude) do not.
  // Continue to support toggling with plugin.name for backwards compatibility.
  it('loads destinations when `All: false` but is enabled (pluginName)', async () => {
    const cdnSettings = {
      integrations: {
        ...cdnSettingsMinimal.integrations,
        oldValidName: {
          versionSettings: {
            componentTypes: [],
          },
        },
      },
      remotePlugins: [
        {
          name: 'valid',
          creationName: 'oldValidName',
          url: 'cdn/path/to/file.js',
          libraryName: 'testPlugin',
          settings: {
            subscriptions: [],
            versionSettings: {
              componentTypes: [],
            },
          },
        },
      ],
    }

    await AnalyticsBrowser.load(
      { writeKey: '', cdnSettings },
      {
        integrations: {
          All: false,
          valid: true,
        },
      }
    )

    expect(pluginFactory).toHaveBeenCalledTimes(1)
    expect(pluginFactory).toHaveBeenCalledWith(
      expect.objectContaining(cdnSettings.remotePlugins[0].settings)
    )
  })

  it('loads destinations when `All: false` but is enabled (creationName)', async () => {
    const cdnSettings = {
      ...cdnSettingsMinimal,
      integrations: {
        ...cdnSettingsMinimal.integrations,
        oldValidName: {
          versionSettings: {
            componentTypes: [],
          },
        },
      },
      remotePlugins: [
        {
          name: 'valid',
          creationName: 'oldValidName',
          url: 'cdn/path/to/file.js',
          libraryName: 'testPlugin',
          settings: {
            subscriptions: [],
            versionSettings: {
              componentTypes: [],
            },
          },
        },
      ],
    }

    await AnalyticsBrowser.load(
      { writeKey: '', cdnSettings },
      {
        integrations: {
          All: false,
          oldValidName: true,
        },
      }
    )

    expect(pluginFactory).toHaveBeenCalledTimes(1)
    expect(pluginFactory).toHaveBeenCalledWith(
      expect.objectContaining(cdnSettings.remotePlugins[0].settings)
    )
  })

  it('does not load destinations when disabled via pluginName', async () => {
    const cdnSettings = {
      ...cdnSettingsMinimal,
      integrations: {
        ...cdnSettingsMinimal.integrations,
        oldValidName: {
          versionSettings: {
            componentTypes: [],
          },
        },
      },
      remotePlugins: [
        {
          name: 'valid',
          creationName: 'oldValidName',
          url: 'cdn/path/to/file.js',
          libraryName: 'testPlugin',
          settings: {
            subscriptions: [],
            versionSettings: {
              componentTypes: [],
            },
          },
        },
      ],
    }

    await AnalyticsBrowser.load(
      { writeKey: '', cdnSettings },
      {
        integrations: {
          All: true,
          valid: false,
        },
      }
    )

    expect(pluginFactory).toHaveBeenCalledTimes(0)
  })

  it('does not load destinations when disabled via creationName', async () => {
    const cdnSettings = {
      integrations: {
        ...cdnSettingsMinimal.integrations,
        oldValidName: {
          versionSettings: {
            componentTypes: [],
          },
        },
      },
      remotePlugins: [
        {
          name: 'valid',
          creationName: 'oldValidName',
          url: 'cdn/path/to/file.js',
          libraryName: 'testPlugin',
          settings: {
            subscriptions: [],
            versionSettings: {
              componentTypes: [],
            },
          },
        },
      ],
    }

    await AnalyticsBrowser.load(
      { writeKey: '', cdnSettings },
      {
        integrations: {
          All: true,
          oldValidName: false,
        },
      }
    )

    expect(pluginFactory).toHaveBeenCalledTimes(0)
  })

  it('applies remote routing rules based on creation name', async () => {
    const validPlugin = {
      name: 'valid',
      version: '1.0.0',
      type: 'destination',
      load: () => {},
      isLoaded: () => true,
      track: (ctx: Context) => ctx,
    }

    const cdnSettings: CDNSettings = {
      ...cdnSettingsMinimal,
      middlewareSettings: {
        routingRules: [
          {
            matchers: [
              {
                ir: '["=","event",{"value":"Item Impression"}]',
                type: 'fql',
              },
            ],
            scope: 'destinations',
            target_type: 'workspace::project::destination::config',
            transformers: [[{ type: 'drop' }]],
            destinationName: 'oldValidName',
          },
        ],
      },
      remotePlugins: [
        {
          name: 'valid',
          creationName: 'oldValidName',
          url: 'valid',
          libraryName: 'valid',
          settings: { foo: true },
        },
      ],
    }

    // @ts-expect-error not gonna return a script tag sorry
    jest.spyOn(loader, 'loadScript').mockImplementation((url: string) => {
      if (url === 'valid') {
        window['valid'] = jest.fn().mockImplementation(() => validPlugin)
      }

      return Promise.resolve(true)
    })

    const middleware = tsubMiddleware(
      cdnSettings.middlewareSettings!.routingRules
    )

    const plugins = await remoteLoader(
      cdnSettings,
      {},
      {},
      undefined,
      middleware
    )
    const plugin = plugins[0]
    await expect(() =>
      plugin.track!(new Context({ type: 'track', event: 'Item Impression' }))
    ).rejects.toMatchInlineSnapshot(`
      ContextCancelation {
        "reason": "dropped by destination middleware",
        "retry": false,
        "type": "plugin Error",
      }
    `)
  })

  it('only applies destination middleware to destination actions', async () => {
    const validPlugin = {
      name: 'valid',
      version: '1.0.0',
      type: 'enrichment',
      load: () => Promise.resolve(),
      isLoaded: () => true,
      track: (ctx: Context) => ctx,
    }

    const cdnSettings: CDNSettings = {
      ...cdnSettingsMinimal,
      middlewareSettings: {
        routingRules: [
          {
            matchers: [
              {
                ir: '["=","event",{"value":"Item Impression"}]',
                type: 'fql',
              },
            ],
            scope: 'destinations',
            target_type: 'workspace::project::destination::config',
            transformers: [[{ type: 'drop' }]],
            destinationName: 'oldValidName',
          },
        ],
      },
      remotePlugins: [
        {
          name: 'valid',
          creationName: 'oldValidName',
          url: 'valid',
          libraryName: 'valid',
          settings: { foo: true },
        },
      ],
    }

    // @ts-expect-error not gonna return a script tag sorry
    jest.spyOn(loader, 'loadScript').mockImplementation((url: string) => {
      if (url === 'valid') {
        window['valid'] = jest.fn().mockImplementation(() => validPlugin)
      }

      return Promise.resolve(true)
    })

    const middleware = jest.fn().mockImplementation(() => true)

    const plugins = await remoteLoader(
      cdnSettings,
      {},
      {},
      undefined,
      middleware
    )
    const plugin = plugins[0] as ActionDestination
    await plugin.load(new Context(null as any), null as any)
    plugin.addMiddleware(middleware)
    await plugin.track(new Context({ type: 'track' }))
    expect(middleware).not.toHaveBeenCalled()
  })

  it('non destination type plugins can modify the context', async () => {
    const validPlugin = {
      name: 'valid',
      version: '1.0.0',
      type: 'enrichment',
      load: () => Promise.resolve(),
      isLoaded: () => true,
      track: (ctx: Context) => {
        ctx.event.name += 'bar'
        return ctx
      },
    }

    const cdnSettings: CDNSettings = {
      ...cdnSettingsMinimal,
      remotePlugins: [
        {
          name: 'valid',
          creationName: 'valid',
          url: 'valid',
          libraryName: 'valid',
          settings: { foo: true },
        },
      ],
    }

    // @ts-expect-error not gonna return a script tag sorry
    jest.spyOn(loader, 'loadScript').mockImplementation((url: string) => {
      if (url === 'valid') {
        window['valid'] = jest.fn().mockImplementation(() => validPlugin)
      }

      return Promise.resolve(true)
    })

    const plugins = await remoteLoader(cdnSettings, {}, {})
    const plugin = plugins[0] as ActionDestination
    await plugin.load(new Context(null as any), null as any)
    const newCtx = await plugin.track(
      new Context({ type: 'track', name: 'foo' })
    )

    expect(newCtx.event.name).toEqual('foobar')
  })
})
