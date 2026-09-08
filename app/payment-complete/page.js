export const metadata = { title: 'Payment received' }

export default function PaymentCompletePage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400 text-2xl">
          ✓
        </div>
        <h1 className="text-lg font-semibold text-foreground">Payment received</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Thank you. Your payment is being processed and will appear on your account shortly. You can close this window.
        </p>
      </div>
    </main>
  )
}
