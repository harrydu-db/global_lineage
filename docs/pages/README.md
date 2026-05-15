# pages/

One file per top-nav page. Each exports an object:

```ts
{
  id: string,       // hash-route fragment, e.g. 'lineage'
  title: string,    // nav label
  mount: (root: HTMLElement) => Promise<() => void> | (() => void) | void,
}
```

`mount` builds the page DOM into `root` and may return a cleanup
function. The router (`app.js`) calls cleanup when the user navigates
away, then replaces `root.innerHTML` for the next page.

To register a page, import it in `app.js` and add it to the `pages`
array. See [../../docs/ADDING_A_PAGE.md](../../docs/ADDING_A_PAGE.md).
