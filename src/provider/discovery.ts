import type {
  SliceWalletEip6963ProviderDetail,
  SliceWalletProvider
} from "../types"

export const sliceWalletProviderIcon =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAACzklEQVR4nO2c4W3qQBCEKYESKIESKIESKIEOoAPoADqADiiBEiiBEi4aS0j5kZeXELzf7g0rfb9C7PGNjx3fWUwmk0l7g47B2wB4DN4GvA3wvglwAe7gAtzBBbiDC3AHF+AOLsAdXIA7uAB3cAHu4ALcwQW4gwtwBxfgDi7AHVyAO7gAd3AB7uAC3MEFuIML+JLpdNpms1lbLBZttVoNbLfbgcPh8CWPv6/X6+Hz+t/5fD4ci76e1AZooDVgu92unU6ndrvd2qvrfr+3y+UynEMGyRxbA3RHahA02BoYqh6mSItmStcGPAZdF5y1NPM2m80wI7sxQAOvaU/e6c+UekqQEeOe4Hq9tqqlGRHQwMc7uBpr9VKqKmvAfr9v1et8Pr8NIEuhoewM6OErSNdQ1gA1sDEeqqJK2gOS0KgHb8vlslUtPbd08SCW+eHru7s/YmxCDNC6S7UK+O6PM6BaJNVTcJdrQVWWI7paC/qMniqzV/DdH2uAyBxLg2Ina0DmhhzYeDkDssbSwNjJG6Bpnq3ALUrkpKliKdB4eQMyxVKg8fIGCK21GGy45DWA3rIM2nLMbQAZS6HYmcsAKpaCsTOfAWqC0Q0Zbry5DIheJ4JjZ04DomKpzpHo7s9jQNQmfoLYmdeAsRtyosab14AxY2mS2JnbAHE8Hiu+YNWPAWPE0mSNN7cBr46lyWJnDQNe9VYdtM1Y34BXvVUX9HZbnwb8NZYmjZ21DPhLLE0aO2sZ8Oz2ZfLGW8uAZ9aJkjfeWgb8NpZqxtB6uzNA/CSWFoiddQ34SUMu0nhrGvC/WFokdtY24Lu36hL9AEe/BvwrlhaKnfUNeJigaCr0qysJ3u/xMqAjcAHu4ALcwQW4gwtwBxfgDi7AHVyAO7gAd3AB7uAC3MEFuIMLcAcX4A4uwB1cgDu4AHdwAe7gAtzBBbiDC3AHF+AOLsAdXEBz5gOiPFnoRh5YuAAAAABJRU5ErkJggg=="

export const announceSliceWalletProvider = ({
  provider,
  window = globalThis.window
}: {
  provider: SliceWalletProvider
  window?: Window
}) => {
  if (window === undefined) {
    throw new Error("EIP-6963 discovery requires a browser window.")
  }
  const detail = Object.freeze({
    info: Object.freeze({
      icon: sliceWalletProviderIcon,
      name: "Slice Wallet",
      rdns: "so.slice.wallet",
      uuid: window.crypto.randomUUID()
    }),
    provider
  }) satisfies SliceWalletEip6963ProviderDetail
  const announce = () =>
    window.dispatchEvent(
      new CustomEvent("eip6963:announceProvider", { detail })
    )
  window.addEventListener("eip6963:requestProvider", announce)
  announce()
  return () => window.removeEventListener("eip6963:requestProvider", announce)
}
