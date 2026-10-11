import Widget from './Widget.js'

/* Several widgets in one frame: the per-plugin alternative the browser check measures against one frame each. */
const many = (n: number) => function Many({ ctx }: { ctx: Parameters<typeof Widget>[0]['ctx'] }) {
  return <>{Array.from({ length: n }, (_, i) => <Widget key={i} ctx={ctx} />)}</>
}
export const Multi3 = many(3)
export const Multi6 = many(6)
