import {
  type Config,
  ConnectorNotConnectedError,
  getConnection
} from "@wagmi/core"
import type { Hex } from "viem"
import {
  getPermissions,
  grantPermissions,
  revokePermission,
  rotatePermission
} from "../permissions/actions"
import type { SliceWalletProvider } from "../types"
import type {
  SliceWalletWagmiGrantPermissionParameters,
  SliceWalletWagmiPermissionParameters
} from "../types/wagmiPermission"

const getPermissionProvider = async <config extends Config>({
  config,
  connector
}: SliceWalletWagmiPermissionParameters<config>) => {
  const resolvedConnector = connector ?? getConnection(config).connector
  if (resolvedConnector === undefined) throw new ConnectorNotConnectedError()
  const provider = await resolvedConnector.getProvider()
  if (
    typeof provider !== "object" ||
    provider === null ||
    typeof Reflect.get(provider, "request") !== "function"
  ) {
    throw new ConnectorNotConnectedError()
  }
  return provider as Pick<SliceWalletProvider, "request">
}

export const grantSliceWalletPermissions = async <config extends Config>(
  parameters: SliceWalletWagmiGrantPermissionParameters<config>
) =>
  grantPermissions(await getPermissionProvider(parameters), parameters.request)

export const getSliceWalletPermissions = async <config extends Config>(
  parameters: SliceWalletWagmiPermissionParameters<config>
) => getPermissions(await getPermissionProvider(parameters))

export const rotateSliceWalletPermission = async <config extends Config>(
  parameters: SliceWalletWagmiPermissionParameters<config> & {
    permissionId: Hex
  }
) =>
  rotatePermission(
    await getPermissionProvider(parameters),
    parameters.permissionId
  )

export const revokeSliceWalletPermission = async <config extends Config>(
  parameters: SliceWalletWagmiPermissionParameters<config> & {
    permissionId: Hex
  }
) =>
  revokePermission(
    await getPermissionProvider(parameters),
    parameters.permissionId
  )
