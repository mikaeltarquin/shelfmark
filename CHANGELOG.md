# Changelog

Releases of this fork. Images: `ghcr.io/mikaeltarquin/shelfmark:<version>` and `:latest`.

## v1.0.2

### Added
- **Title and General search suggestions**: typing in Title search offers book titles from
  Hardcover with their author ("Words of Radiance — by Brandon Sanderson"), as Author and
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
  own book, `Words of Radiance (1 of 5) {GraphicAudio}/Words of Radiance (1 of 5).m4b`, so
  Audiobookshelf creates one item per part and can match it. The part is read from
  MyAnonamouse's series field ("Elantris #1p2") or the release title ("Part 1 of 5", "Pt. 2",
  "(2 of 3)", "[2/3]").
- **Parts are numbered in their series**: part 1 of book 2 gets series position 2.1, part 2
  gets 2.2, and so on (two decimals for ten or more parts), in `{SeriesPosition}` and
  `metadata.opf`, so the parts sort in order in Audiobookshelf.
- **Library browser sorting**: authors sort by First Last (default) or Last, First, by book
  or series count, or recently added, ascending or descending, with a **table view**. Series
  can also sort by author. Choices are remembered in the browser.

### Fixed
- Parts downloaded through the combined (ebook + audiobook) flow went into one folder
  (`Words of Radiance.m4b`, `_1`, `_2`…), because only the book's title was sent and it
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
