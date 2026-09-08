export const metadata = { title: 'Payment cancelled' }

export default function PaymentCancelledPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground text-2xl">
          ×
        </div>
        <h1 className="text-lg font-semibold text-foreground">Payment cancelled</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          No payment was taken. You can close this window, or contact the studio to try again.
        </p>
      </div>
    </main>
  )
}
