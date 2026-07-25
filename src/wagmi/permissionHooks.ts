"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { Config } from "@wagmi/core"
import type { Hex } from "viem"
import { useConnection } from "wagmi"
import type {
  SliceWalletWagmiGrantPermissionParameters,
  SliceWalletWagmiPermissionHookParameters
} from "../types/wagmiPermission"
import {
  getSliceWalletPermissions,
  grantSliceWalletPermissions,
  revokeSliceWalletPermission,
  rotateSliceWalletPermission
} from "./permissionActions"

const normalizePermissionOrigin = (origin: string) => {
  try {
    return new URL(origin).origin
  } catch {
    return null
  }
}

const usePermissionQueryKey = <config extends Config>({
  config,
  connector,
  origin
}: SliceWalletWagmiPermissionHookParameters<config>) => {
  const connection = useConnection({ config })
  return [
    "slicePermissions",
    connector?.uid ?? connection.connector?.uid ?? null,
    normalizePermissionOrigin(origin),
    connection.address?.toLowerCase() ?? null,
    connection.chainId ?? null
  ] as const
}

export const useSliceWalletPermissions = <config extends Config>(
  parameters: SliceWalletWagmiPermissionHookParameters<config>
) => {
  const queryKey = usePermissionQueryKey(parameters)
  return useQuery({
    enabled:
      queryKey[2] !== null && queryKey[3] !== null && queryKey[4] !== null,
    queryFn: () => {
      if (queryKey[2] === null) {
        throw new Error("Slice permission origin is invalid.")
      }
      return getSliceWalletPermissions(parameters)
    },
    queryKey
  })
}

export const useGrantSliceWalletPermissions = <config extends Config>(
  parameters: SliceWalletWagmiPermissionHookParameters<config>
) => {
  const queryClient = useQueryClient()
  const queryKey = usePermissionQueryKey(parameters)
  return useMutation({
    mutationFn: (
      request: SliceWalletWagmiGrantPermissionParameters<config>["request"]
    ) => grantSliceWalletPermissions({ ...parameters, request }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey })
  })
}

export const useRotateSliceWalletPermission = <config extends Config>(
  parameters: SliceWalletWagmiPermissionHookParameters<config>
) => {
  const queryClient = useQueryClient()
  const queryKey = usePermissionQueryKey(parameters)
  return useMutation({
    mutationFn: (permissionId: Hex) =>
      rotateSliceWalletPermission({ ...parameters, permissionId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey })
  })
}

export const useRevokeSliceWalletPermission = <config extends Config>(
  parameters: SliceWalletWagmiPermissionHookParameters<config>
) => {
  const queryClient = useQueryClient()
  const queryKey = usePermissionQueryKey(parameters)
  return useMutation({
    mutationFn: (permissionId: Hex) =>
      revokeSliceWalletPermission({ ...parameters, permissionId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey })
  })
}
