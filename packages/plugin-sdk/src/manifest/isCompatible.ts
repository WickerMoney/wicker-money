import { SDK_MAJOR_VERSION } from './SDK_MAJOR_VERSION.js'

/**
 * Tells whether the host can load a plugin built against a given SDK major.
 *
 * Older majors are accepted; newer ones are refused.
 *
 * @param pluginSdkMajor - The SDK major the plugin declares in its manifest.
 * @param hostSdkMajor - The SDK major the host implements. Defaults to `SDK_MAJOR_VERSION`.
 * @returns `true` when `pluginSdkMajor` is an integer no greater than `hostSdkMajor`.
 */
export function isCompatible(
  pluginSdkMajor: number,
  hostSdkMajor: number = SDK_MAJOR_VERSION,
): boolean {
  return Number.isInteger(pluginSdkMajor) && pluginSdkMajor <= hostSdkMajor
}
