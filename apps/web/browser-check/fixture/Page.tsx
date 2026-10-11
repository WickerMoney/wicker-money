export default function Page({ ctx }: { ctx: { session: { email: string }; navigate(path: string): void } }) {
  return (
    <main>
      <h2>Fixture page</h2>
      <p id="who">{ctx.session.email}</p>
      <button id="go" type="button" onClick={() => { ctx.navigate('/transactions') }}>go</button>
    </main>
  )
}
