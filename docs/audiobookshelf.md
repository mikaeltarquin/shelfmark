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

## Consistent series and titles

Audiobookshelf reads a book's metadata from several sources, each overriding the one before: folder names, the audio file's tags (or the ebook's own metadata), `.nfo`, `desc.txt`/`reader.txt`, an `.opf` file, then `metadata.json`. Releases tag their files differently, so books of one series can import with the series spelled differently, or with none at all.

Turn on **Settings > Downloads > Audiobooks > Write Audiobookshelf Metadata** (`WRITE_AUDIOBOOKSHELF_OPF`, off by default, needs **Rename and Organize**) and Shelfmark saves a `metadata.opf` into each audiobook folder before the files arrive. It holds the title, subtitle, authors, narrators, year, language and the series with its number from Shelfmark's metadata provider, so every book of a series gets the same series name. With **Keep Ebooks With Audiobooks** on, the ebook's folders in the audiobook library get one too. Folders elsewhere, such as a Calibre-Web ingest folder, never do.

- It ranks below `metadata.json` on purpose. Audiobookshelf keeps its own copy of each book's metadata, including your edits, as a `metadata.json`, so edits made in Audiobookshelf still win on later scans. It also means the file only takes effect for books Audiobookshelf hasn't imported yet.
- Audiobookshelf only takes non-empty values from it. A subtitle the release's tags carry stays when Shelfmark has none to replace it with.
- A folder that already has an `.opf` is left alone, since Audiobookshelf reads only one per folder.

## Books released in parts

Some publishers split one book into several releases: GraphicAudio's dramatizations come
in parts, each its own torrent. Shelfmark reads the part from MyAnonamouse's series field
("Elantris #1p2") or, for other sources, from the title ("Part 2", "Pt. 2", "(2 of 3)"),
and files each part as its own book, so Audiobookshelf gets one item per part that it can
match:

```
Brandon Sanderson/Elantris (1 of 2) {GraphicAudio}/Elantris (1 of 2).m4b
Brandon Sanderson/Elantris (2 of 2) {GraphicAudio}/Elantris (2 of 2).m4b
```

The part is read from the release's own title, also in the combined (ebook + audiobook)
flow, where the book's title doesn't name the part ("Words of Radiance (Part 1 of 5)" with
the series field "Stormlight Archive #2"). The part goes into the title everywhere `{Title}`
is used, and into the `metadata.opf`. The number of parts comes from the release title
("(1 of 2)"); when no release says it, the part is written `Elantris (Part 1)`.

Each part is also numbered in its series after the book, so the parts sort in order: with
the book's series position from your metadata provider, part 1 of book 2 is **2.1**, part 2
is 2.2, and so on (a book in ten or more parts uses two decimals: 2.01 … 2.12). The number
goes into `{SeriesPosition}` and the `metadata.opf`. A release with no known series position,
or one already fractional (a novella at 1.5), keeps its position as it is.

Parts are left out of [Keep Ebooks With Audiobooks](#keeping-ebooks-with-audiobooks): the
ebook stays in its own folder rather than in one part's. The library check and the library
browser still count the parts as the audiobook of the book, shown once at the book's own
series number.
