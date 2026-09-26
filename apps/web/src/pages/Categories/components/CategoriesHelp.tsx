/** The two explanatory notes under the category table. */
export function CategoriesHelp() {
  return (
    <>
      <p className="form-hint">
        <strong>Counts as</strong> decides whether spending here is counted.
        A <strong>transfer</strong> category — a credit card payment, money into
        savings — is left out of both spending and income, because it is money
        moving rather than money earned or spent. Setting it on a parent sets it
        on the children too.
      </p>

      <p className="form-hint">
        <strong>Disable</strong> hides a category from every picker and keeps every
        transaction already filed under it. <strong>Delete</strong> only works on a
        category nothing is using — the slug is what the starter set and a future legacy
        import match on, so it is never editable.
      </p>
    </>
  )
}
