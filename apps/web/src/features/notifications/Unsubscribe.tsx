import { useMutation } from '@tanstack/react-query'
import { useSearch } from '@tanstack/react-router'
import { notifications } from '@/api/endpoints'
import { Button, Card } from '@/design-system'

/** The link in the daily summary email. The signed link is the proof, so no sign-in is needed. */
export function Unsubscribe() {
  const { token } = useSearch({ strict: false }) as { token?: string }
  const stop = useMutation({ mutationFn: () => notifications.unsubscribe(token ?? '') })
  return (
    <main className="mx-auto flex min-h-full max-w-md items-center p-4">
      <Card className="w-full">
        <h1 className="text-base font-bold text-ink">Daily summary emails</h1>
        {stop.isSuccess ? (
          <p role="status" className="mt-2 text-sm text-ink">You will not get the daily summary any more. You can turn it back on in the bell's settings.</p>
        ) : (
          <>
            <p className="mt-2 text-sm text-muted">Stop the one email a day that lists what you have not read?</p>
            {stop.isError && <p role="alert" className="mt-2 text-sm text-bad">This link is not valid. Turn the summary off in the bell's settings instead.</p>}
            <Button className="mt-3" onClick={() => stop.mutate()} loading={stop.isPending} disabled={!token}>Stop the daily emails</Button>
          </>
        )}
      </Card>
    </main>
  )
}
