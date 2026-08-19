export const maximumWalletAllowanceUsdMicros =
  340282366920938463463374607431768211455n
export const maximumWalletAllowanceUsdMicrosDecimal =
  "340282366920938463463374607431768211455"

const canonicalWalletAllowancePattern = /^[1-9]\d{0,38}$/

export const parseWalletAllowanceUsdMicros = (
  value: bigint | string
): string => {
  const serialized = typeof value === "bigint" ? value.toString() : value
  if (!canonicalWalletAllowancePattern.test(serialized)) {
    throw new Error(
      "Wallet allowance must be a canonical positive uint128 decimal."
    )
  }
  const parsed = BigInt(serialized)
  if (parsed > maximumWalletAllowanceUsdMicros) {
    throw new Error("Wallet allowance exceeds uint128.")
  }
  return serialized
}

export const addWalletAllowanceUsdMicros = (
  values: readonly (bigint | string)[]
): string => {
  let total = 0n
  for (const value of values) {
    const parsed = BigInt(parseWalletAllowanceUsdMicros(value))
    if (parsed > maximumWalletAllowanceUsdMicros - total) {
      throw new Error("Wallet allowance sum exceeds uint128.")
    }
    total += parsed
  }
  if (total === 0n) {
    throw new Error("Wallet allowance sum must be positive.")
  }
  return total.toString()
}
