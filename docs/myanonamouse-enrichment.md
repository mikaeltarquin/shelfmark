# MyAnonamouse Enrichment

Prowlarr's MyAnonamouse indexer keeps the title, author, language and file type of each result but drops the narrator and series, and Torznab has no field to carry them. With a MyAnonamouse session ID, Shelfmark looks those details up directly from MyAnonamouse and adds them to the Prowlarr release list.

## What you get

| Column | Shown for | Source |
|--------|-----------|--------|
| Series | Books and audiobooks | MAM series info, e.g. `The Sun Eater #1` |
| Narrator | Audiobooks | MAM narrator info |
| Bitrate | Audiobooks | Parsed from the uploader's tags (e.g. `64 kbps`), so some releases have none |

The narrator is also available to audiobook naming templates as `{Narrator}`, see [Audiobookshelf Folders](audiobookshelf.md).

Only MyAnonamouse results are enriched. Other Prowlarr indexers fill the bitrate column only if they report a Torznab `bitrate` attribute, which most don't. AudiobookBay's bitrate column is unaffected and follows the same toggle.

## Setup

1. On MyAnonamouse, open **Preferences > Security** and create a session for Shelfmark. Lock it to the public IP (or ASN) Shelfmark connects from.
2. In Shelfmark, open **Settings > Prowlarr > MyAnonamouse Enrichment**, paste the `mam_id` value into **MAM Session ID** (or set `PROWLARR_MAM_ID`), and click **Test MAM Session**.
3. Choose which columns appear under **Settings > Search Mode > Release List Columns** (`SHOW_SERIES_COLUMN`, `SHOW_NARRATOR_COLUMN`, `SHOW_BITRATE_COLUMN`). Users can override these for their own account.

## Use a session made for Shelfmark

MyAnonamouse locks each session to one IP or ASN. Reusing the session Prowlarr (or a seedbox script) uses often fails with **403**:

- If Shelfmark reaches MAM from a different IP than that session was created for (another host, a VPN container, or a proxy set under **Settings > Network**), MAM rejects it.
- If the existing session is ASN-locked to another network, it will not work from Shelfmark's network either.

In either case, create a separate session for Shelfmark. To see the IP Shelfmark connects from:

```bash
docker exec shelfmark curl -s https://api.ipify.org
```

Compare it with the IP listed next to the session on MAM's security page.

## How it works

After a Prowlarr search, Shelfmark reruns the search Prowlarr sent to MyAnonamouse's JSON search API: the same cleaned-up query text, the same categories (audiobooks, or e-books), and your MyAnonamouse indexer's own options from Prowlarr (search type, search in description/series/filenames, languages). That normally returns the same torrents in one request per title. Shelfmark then matches them back to Prowlarr's results by their MAM torrent ID. Only results from the MyAnonamouse indexer are looked up, and the session ID is only ever sent to `https://www.myanonamouse.net`.

If some torrents are missing from the first page, Shelfmark reads further pages, up to 4 requests per search. Lookups are cached for an hour, stay inside the Prowlarr search time budget, and never fail the search: if MAM errors or rejects the session, the release list simply shows without the extra columns filled in.

After a failed request (a 403, a timeout, an unexpected reply), Shelfmark waits before trying MAM again: 1 minute, then 2, 4 and so on, up to 30 minutes. After 10 failures in a row it stops using MAM. **Test MAM Session** (once it succeeds), a new session ID, or a restart turns it back on. Each failure is logged with the reason.

## Account panel

With a MAM session ID set, admins get a **MyAnonamouse** button in the header, between
Library and Activity. It shows the account's ratio and unsatisfied count at a glance (amber
or red as they near their limits, refreshed every 5 minutes), and opens a panel with links
to your MAM profile and the MAM store. The panel shows:

- **Account:** ratio, buffer (uploaded − downloaded), bonus points, uploaded, downloaded, class, VIP expiry and unsatisfied torrents against your class's limit (amber at 90%, red at the limit), from MAM's `jsonLoad.php?snatch_summary`. Refreshed at most once a minute unless you press **Refresh**.
- **Points / hour:** MAM's API has no earning rate, so Shelfmark estimates it from its own readings of your balance (taken hourly, kept for two days) over the last 24 hours. Points Shelfmark spent on upload credit are added back; a period where points dropped for another reason (spending on MAM's site) or hit MAM's 99,999 cap is left out. It shows once a few hours of readings exist.
- **Connections:** whether MAM accepts the session, and whether Shelfmark can reach its torrent client, each with the error when it can't.
- **Buy upload credit:** spends bonus points in MAM's store (500 points per GB). Pick 50, 100, 250 or 500 GB, a custom amount in multiples of 50 GB, or **Max affordable**. Nothing is bought until you confirm. Larger amounts are bought as 100 GB and 50 GB purchases, and a purchase stops at the first one MAM declines, reporting what was already added.

Every Shelfmark user shares the one MAM account, so the panel and purchases are admin-only. Without login, everyone counts as an admin.

## Projected ratio and buffer check

MyAnonamouse results are recognised by their MAM torrent link, whether or not enrichment details were found.

- **Projected ratio:** when you pick a book and audiobooks together, a line under the picks shows what your MAM ratio and buffer become once they download: `MAM ratio 3.01 → 2.87 · buffer 80.5 GiB → 45.5 GiB`. It counts Shelfmark's MAM downloads that are still active, leaves freeleech torrents out, turns amber below a 2.0 ratio (MAM's minimum for renewing VIP) and red below 1.0 or when the buffer would run out. Every user sees it; it shows no username or bonus points.
- **Buffer check** (**Hold Back Downloads Larger Than the Buffer**, `MAM_BLOCK_ON_LOW_BUFFER`, on by default): before MAM torrents are queued, Shelfmark checks that they, plus its still-active MAM downloads, fit in the buffer. Picks made together are checked together, so none is queued unless all fit. If they don't, admins are offered the smallest upload credit purchase that covers the shortfall (or another amount) and the downloads go ahead once it is bought; other users are asked to contact an admin. Freeleech torrents don't count, and if MAM can't be reached the downloads go ahead.

Active downloads are counted at their full size, because MAM's figures only include what a torrent has downloaded so far; this errs towards a smaller buffer.

## Upload credit auto-buy

Under **Settings > Prowlarr > Upload Credit Auto-Buy**, Shelfmark can spend bonus points on upload credit by itself. Each mode is off until you turn it on:

| Mode | Buys when | Default threshold | Default amount |
|------|-----------|-------------------|----------------|
| **Buy When Ratio Is Low** | ratio is below the threshold | 2.0 (MAM's minimum for renewing VIP) | 50 GB |
| **Buy When Buffer Is Low** | buffer (uploaded − downloaded) is below the threshold | 10 GB | 50 GB |
| **Spend Excess Bonus Points** | bonus points are at or above the threshold, repeatedly | 50,000 | 50 GB |

- Checks run every **Check Every (Hours)** (6 by default), a minute after Shelfmark starts, and about 20 seconds after a MAM download is queued. **Check now** in the MyAnonamouse panel runs one immediately.
- Ratio and buffer buy at most once per check, and buffer only when ratio didn't. The bonus mode stops after 20 purchases in one check, as soon as bonus points don't go down, or when a purchase fails.
- **Keep at Least (Points)** is a floor auto-buy never spends below. Manual purchases ignore it.
- Amounts are in multiples of 50 GB; other values are rounded down.
- The ratio line's amber warning follows the ratio threshold.
- Every purchase, manual or automatic, is listed under **Recent purchases** in the MyAnonamouse panel with its reason, and kept in `mam_purchases.json` in the config folder.

## Unsatisfied limit

MyAnonamouse limits how many torrents can be unsatisfied (not yet seeded 72 hours) at once, by class. With **Hold Back Downloads at the Unsatisfied Limit** (`MAM_BLOCK_ON_UNSAT_LIMIT`, on by default), MAM torrents are held back when they, plus Shelfmark's MAM downloads not yet handed to the torrent client, would leave fewer free slots than **Unsatisfied Slots to Keep Free** (`MAM_UNSAT_RESERVE_SLOTS`, 5). Every MAM torrent counts, freeleech too. Upload credit can't fix this, so none is offered: wait for torrents to finish seeding or pick fewer. The projected-ratio line also shows `unsatisfied 94 → 98 / 100`, red when the picks would be held back.

### When slots free up

The account panel (and the header button's tooltip) also estimates when unsatisfied
torrents free their slots: `Next slot in 2:05 · 3 slots in the next 6 hours`. MAM's API
only reports how many torrents are unsatisfied, so the timing comes from your torrent
client: each MyAnonamouse torrent it is seeding that hasn't reached 72 hours frees a slot
after 72 hours minus the time it has already seeded.

- Works with **Deluge**, **qBittorrent** and **Transmission**, which report seeding time.
  Other clients show why there's no estimate.
- It's an estimate. MAM keeps its own clock, so time spent paused or offline pushes the
  real moment later.
- Torrents still downloading haven't started their 72 hours. Torrents MAM counts but that
  are no longer in your client can't be timed, and don't free a slot by seeding.
- Only counts and times are shown, no torrent names, so every user can see it.
