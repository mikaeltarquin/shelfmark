# Saved for Later

Keep books to download later, for example when you're out of MyAnonamouse upload credit
or unsatisfied slots. Each user has their own list. With no login, everyone shares one.

## Saving

- **A book**: the bookmark on a search result or library card (beside Details and Get on
  a phone), or at the left of a row in the library's tables. Saved this way, you pick a
  release when you get it. A library book held in one format is saved for the other.
- **One release**: the bookmark beside a release's download button. Getting it later
  downloads exactly that release.
- **A combined pick**: in the combined (ebook + audiobook) flow, **Save for later** in the
  footer keeps everything picked so far: the ebook and every audiobook (narrator).
- **From the hold-back prompt**: when a download is held back for the MyAnonamouse buffer
  or the unsatisfied limit, **Save for later** in that prompt keeps exactly what you were
  downloading (one release, or the whole combined pick) instead of dropping it. It isn't
  offered while acting on behalf of another user.

A book is saved once. Saving it again with a release replaces the earlier pick, and
saving it again on its own keeps the pick. A filled bookmark means the book (or, on a
release row, that release) is saved; click it again to remove it.

## Saved for later, or queued for download

A saved item is one of two things, marked on books everywhere they show:

- **Saved for later** (amber bookmark): a book with no release picked yet, or picks you'll
  get by hand.
- **Queued** (blue): releases are picked and it downloads on its own once there's room
  (see below). Picking releases queues them straight away when **Get Saved Books
  Automatically** is on.

## The Queued and Later tabs

**Activity → Queued** and **Activity → Later** list your saved books, with what each will download ("Ebook EPUB +
audiobook, Narrator Name", or "Book only"). **+ Get** downloads it through the usual path:
the MyAnonamouse buffer and unsatisfied checks still apply, and for users who need
approval it becomes a request. A book saved on its own opens its releases instead.

A book leaves Saved once it's downloaded: on Get, or when you download it (or one of its
picked releases) any other way.

## Getting automatically

A saved item with picked releases can download on its own once it makes sense to. It's
queued as it's saved; in **Activity → Queued**, untick **Queue for download** to keep it for
later instead, or tick it on an older pick. A background check (every 10 minutes by
default, and a few seconds after you tick it) gets it once:

- its MyAnonamouse torrents fit the buffer and the unsatisfied limit, the same check as a
  manual download (keeping the slots set in **Unsatisfied Slots to Keep Free**);
- you could download it directly, without a request (users who need approval use **Get**);
- it won't drag your ratio down, by one rule for every item:
  - **Freeleech** torrents go as soon as there's room, since they can't lower the ratio.
    Freeleech is checked live on MyAnonamouse at each check, so a site-wide freeleech, a
    personal freeleech wedge, or VIP freeleech (for a VIP account) all count;
  - anything else goes when the ratio stays at **Keep Ratio At Least** (2.0 by default)
    with this download and Shelfmark's other active MAM downloads counted in full, or
    when it's small enough to barely move the ratio (less than 0.01, an ebook say);
  - otherwise it waits until the ratio allows it or the torrent turns freeleech,
    whichever comes first.

Upload credit is never bought for an automatic download. Items are checked in the order
they were saved, so earlier ones get free slots first. Each item shows why it's still
waiting ("Waiting for 2 unsatisfied slots", "Waiting for freeleech or ratio 2.00: 1.20 GB
would take it from 1.84 to 1.81") and when it was last checked. If MyAnonamouse can't be
read, items wait rather than risk the account. Releases
that aren't MyAnonamouse torrents have nothing to wait for and download at the next check.

Once it's queued, the item leaves Saved, a toast says so, and a **Saved book got
automatically** notification goes out to notification routes subscribed to that event
(or to **All**). If part of a combined pick can't be queued, the rest still downloads and
what's left stays saved with the error, with automatic downloading turned off.

**Settings → Prowlarr → Saved for Later** has the global switch (**Get Saved Books
Automatically**, on by default; turning it off pauses every item without unmarking it),
**Keep Ratio At Least** (0 turns the ratio check off) and the check interval (at least 5
minutes).
