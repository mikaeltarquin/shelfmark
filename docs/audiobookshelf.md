# Audiobookshelf Folders

Audiobookshelf treats each folder as one library item. Two things follow from that:

- An ebook and an audiobook of the same book show as **one item** only when they are in the same folder.
- Different narrations of one book need **separate folders**, and each needs its own copy of the ebook.

Audiobookshelf reads the narrator from a `{...}` part of the folder name:

```
/books/Robert Jordan/The Eye of the World {Rosamund Pike}/The Eye of the World.m4b
/books/Robert Jordan/The Eye of the World {Rosamund Pike}/The Eye of the World.epub
/books/Robert Jordan/The Eye of the World {Kate Reading & Michael Kramer}/The Eye of the World.m4b
/books/Robert Jordan/The Eye of the World {Kate Reading & Michael Kramer}/The Eye of the World.epub
```

## The `{Narrator}` variable

Audiobook templates can use `{Narrator}`. Narrators come from [MyAnonamouse Enrichment](myanonamouse-enrichment.md); other sources do not report one. An audiobook without a narrator gets `Audiobook`, so it still has its own folder (`The Eye of the World {Audiobook}`). Ebooks have no narrator.

Several narrators are joined with **Narrator Separator** (`NARRATOR_SEPARATOR`): `&` (default) gives `Kate Reading & Michael Kramer`, `,` gives `Kate Reading, Michael Kramer`.

Braces nested inside a template block are kept as text, so `{{Narrator}}` renders `{Rosamund Pike}` and disappears entirely when there is no narrator (the space before it is trimmed too). The recommended audiobook **Path Template** is:

```
{Author}/{Title} {{Narrator}}/{Title}
```

or, with series folders:

```
{Author}/{Series/}{Title} {{Narrator}}/{Title}{ - Part }{PartNumber}
```

## Keeping ebooks with audiobooks

Turn on **Settings > Downloads > Audiobooks > Keep Ebooks With Audiobooks** (`EBOOKS_WITH_AUDIOBOOKS`). It needs audiobook **File Organization** set to **Rename and Organize**, and works in Universal search mode, where the ebook and the audiobook get the same title and author from the same metadata book.

Ebooks are still saved to the Books destination as usual. In addition, Shelfmark uses the audiobook Path Template to find the book's folders under the audiobook destination:

| What arrives | What Shelfmark does |
|--------------|---------------------|
| Ebook, audiobooks already present | Links (or copies) the ebook into every narration's folder. |
| Ebook, no audiobook yet | Puts it in the folder the template gives without a narrator (`The Eye of the World/`). |
| Audiobook | Links (or copies) the ebook in from another narration's folder, the narrator-less folder, or the Books destination. |

When you download a book and its audiobooks together (combined search: select the book, then the audiobooks), the ebook already knows which narrations are coming. It is saved straight into their folders (`The Eye of the World {Rosamund Pike}/`) instead of the narrator-less one, so the audiobook later lands in an item Audiobookshelf already has rather than moving the ebook out from under it. You can tick several audiobooks on that step, one per narration; the ebook goes into each of their folders. Audiobooks that are only requested, not downloaded, don't count: the request might never be fulfilled.

Once a book has an audiobook folder, the narrator-less ebook-only folder is emptied into it and removed, so Audiobookshelf does not keep a second, ebook-only item. Audiobookshelf's own `cover.*` and `metadata.json` in that folder are removed with it; if it holds anything else, the folder is left in place and a warning is logged.

Ebooks are hardlinked when the folders are on the same filesystem, and copied otherwise. An audiobook folder that already has an ebook of that format is left alone. Multi-book packs are skipped.

If the audiobook template has no `{Narrator}`, all narrations share one folder and the ebook goes into that folder.
