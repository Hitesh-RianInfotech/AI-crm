// The only payment methods staff can record. "card" is the stored value on every
// Payment row and on the backend enums; "Clover" is only what we call it, because a
// card payment is always collected through Clover's hosted checkout.
//
// Wallet is a method here. When the balance cannot cover the amount, the form asks for a
// second method to collect the difference rather than failing — see WalletShortfallField.
export const PAYMENT_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "terminal", label: "Terminal" },
  { value: "wallet", label: "Wallet" },
]

// One-time purchase forms carry their own "Use wallet balance" toggle, which splits
// the price between the wallet and another method. Offering Wallet as a method there
// too would give staff two different ways to spend the same balance.
export const PURCHASE_METHODS = PAYMENT_METHODS.filter((m) => m.value !== "wallet")

// A tip is never drawn from the wallet: Tip rows have no wallet-debit hook (that
// lives on Payment), so a wallet tip would credit a teacher out of nothing. The
// backend Tip.method enum excludes it too.
export const TIP_METHODS = PURCHASE_METHODS

// The methods that can cover what the wallet cannot.
export const SHORTFALL_METHODS = PURCHASE_METHODS
