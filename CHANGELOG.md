# Changelog

Releases of this fork. Images: `ghcr.io/mikaeltarquin/shelfmark:<version>` and `:latest`.

## Unreleased

### Added
- **Your copies on every book page**: the library section of the book details lists the
  copies (format, narrator, size, folder, files, open link) wherever the details open,
  from an Activity row, a library card or a search result alike, not only from search.
- **Downloads wait for an unsatisfied slot instead of failing**: a MyAnonamouse torrent
  that reaches its turn with no slot free (counting **Unsatisfied Slots to Keep Free**),
  or whose grab MAM refuses at the limit, goes back to the queue as "Waiting for an
  unsatisfied slot" and starts on its own once a slot frees up (checked every 5
  minutes), longest waiting first. The hold-back prompt offers **Queue and wait for a
  slot** when slots are all that's missing.
- **Activity rows open the book**: click a download (in Downloads or History) to see the
  book's details and your library copies. A failed or cancelled one says why, with
  **Retry download**; History rows get a Retry button too. Saving a finished file to this
  device is now a small download button on the row rather than the title link.
- **Smarter automatic downloads from Saved**: one **Get automatically** switch per item
  instead of freeleech and ratio checkboxes. Freeleech torrents go as soon as there's
  room, even while the ratio is below target; small downloads that barely move the ratio
  (ebooks) go too; anything else waits for the ratio or for freeleech. The target is one
  setting, **Keep Ratio At Least** (2.0), under Prowlarr → Saved for Later.
- **See what's already saved or downloaded**: search results (cards, list and compact),
  the library's book tables and covers, author and series rows, and the book details show
  **Saved** and **Downloading / Downloaded / Failed** marks, so you don't save or get a
  book twice. Downloads now record the book they were for; older downloads (and library
  books) are matched by title and author.
- **Library views work alike**: All, Authors and Series each have a Grid and a Table
  layout and a format filter. In the Authors and Series tables a row opens onto its
  books, and **Owned / Missing / Owned + missing** shows the books the metadata provider
  lists that you don't have, in line with your own (in series order, with **Get**), with
  no need to open the author or series page. Authors' **Author › Series › Book** sort
  (formerly "Series") orders each author's books by series, then number.
- **What's in your library, on the book details**: for admins, the Library section now
  lists every library copy of the book, not just "Have ebook + audio". Each copy shows its
  library, format (audiobook, ebook, EPUB/AZW3…), narrator, year, length, size and
  folder path, with **Show files** to list its files and a link to open it in
  Audiobookshelf or Calibre-Web.
- **Saved for later**: bookmark a book, one release, or a combined ebook + audiobook pick to
  download later, from search results, library cards, release lists and the combined
  flow, or straight from the MyAnonamouse hold-back prompt when a download doesn't fit.
  Saved items live in a new **Saved** tab in Activity, per user, with **+ Get** to
  download them through the usual checks.
- **Get saved books automatically**: tick *Get automatically when there's room* on a saved
  pick and it downloads once its MyAnonamouse torrents fit the buffer and unsatisfied
  limit, optionally only when freeleech (checked live) and only while the ratio after the
  download stays at or above a set value (2.0 by default). Never buys upload credit;
  shows why each item is waiting; sends a *Saved book got automatically* notification.
- **When unsatisfied slots free up**: the MyAnonamouse panel and the header button's
  tooltip estimate when the next unsatisfied torrent reaches 72 hours seeded and how many
  will in the next 6 hours ("Next slot in 2:05 · 3 slots in the next 6 hours"), from the
  seeding time Deluge, qBittorrent or Transmission reports.

### Fixed
- Automatic downloads from Saved could queue past the MyAnonamouse unsatisfied limit:
  a torrent handed to the client (an ebook that finished in seconds, say) stopped
  counting before MAM's own count caught up, and MAM then refused the rest. Snatches
  since shortly before the account was read now count until MAM's figure includes them.
- **Clear Completed** in Activity no longer clears failed downloads; dismiss those one
  by one (cleared items are still under History).

## v1.0.2

### Added
- **Title and General search suggestions**: typing in Title search offers book titles from
  Hardcover with their author ("Book Title — by Firstname Lastname"), as Author and
  Series already did. General search suggests books, series and authors together, each
  marked with an icon. Picking a book searches for it, a series opens it in reading order,
  and an author switches to an Author search.
- **MyAnonamouse in the header**: the MyAnonamouse button moves out of the menu to sit
  between Library and Activity, and shows the account's ratio and unsatisfied count
  (amber or red near the limits), refreshed every 5 minutes and after closing the panel.
  It has a mouse icon, and the panel links to your MAM profile and the MAM store.
- **Library links named after where they go**: the header's "Go To Library" buttons now
  read "Audiobookshelf", "Calibre-Web", "Plex"..., worked out from the link (or the
  connected Audiobookshelf server), or set your own under Settings › General.

### Fixed
- The Content / Search by panel on a results page opens below the search bar instead of
  beside it, over the header menus.
- After picking an author or series suggestion, the search box can be edited again.

## v1.0.1

### Added
- **Books released in parts** (GraphicAudio and similar): each part of a book is filed as its
  own book, `Book Title (1 of 5) {GraphicAudio}/Book Title (1 of 5).m4b`, so
  Audiobookshelf creates one item per part and can match it. The part is read from
  MyAnonamouse's series field ("Series Name #1p2") or the release title ("Part 1 of 5", "Pt. 2",
  "(2 of 3)", "[2/3]").
- **Parts are numbered in their series**: part 1 of book 2 gets series position 2.1, part 2
  gets 2.2, and so on (two decimals for ten or more parts), in `{SeriesPosition}` and
  `metadata.opf`, so the parts sort in order in Audiobookshelf.
- **Library browser sorting**: authors sort by First Last (default) or Last, First, by book
  or series count, or recently added, ascending or descending, with a **table view**. Series
  can also sort by author. Choices are remembered in the browser.

### Fixed
- Parts downloaded through the combined (ebook + audiobook) flow went into one folder
  (`Book Title.m4b`, `_1`, `_2`…), because only the book's title was sent and it
  doesn't name the part. The release's title is now used.
- In the combined flow, an ebook downloaded with a part was placed in that part's narrator
  folder. It now goes to its own folder.
- The library browser shows a book downloaded in parts once, at the book's own series
  number, not once per part.
- Blue "added to queue" toasts sometimes stayed on screen when several books were queued
  at once. Every toast now dismisses after a few seconds.

### Upgrading
Parts downloaded before this release stay where they are. To file them per part, delete
the shared folder and download the parts again, or move and renumber them in Audiobookshelf.

## v1.0.0

First release of the fork: Audiobookshelf-friendly file layout (`{Narrator}`, Keep Ebooks
With Audiobooks, several audiobooks per book, `metadata.opf`), MyAnonamouse account tools
(account panel, buying upload credit, auto-buy, projected ratio, buffer check, unsatisfied
limit guard), the Audiobookshelf library check, the Libraries settings group, and the
library browser (All, Authors, Series, "Not in your library", + Get on every card). See
[About this fork](readme.md#-about-this-fork).
