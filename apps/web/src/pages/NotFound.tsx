/** The page shown for an address that no core or plugin route handles. */
export function NotFound() {
  return (
    <div className="page">
      <h1 className="page__title">Page not found</h1>
      <p>There is nothing at this address.</p>
    </div>
  )
}
