import type { ActivityItem } from '../components/activity/activityTypes';
import { getMetadataBookInfo, searchMetadata } from '../services/api';
import type { Book } from '../types';
import { isSameBook, parseBookKey } from './bookActivity';

/**
 * The book an Activity row was downloaded for: the one the download recorded when it
 * did, else the metadata provider's match for its title and author (older downloads).
 * Null when neither finds it.
 */
export const findActivityBook = async (item: ActivityItem): Promise<Book | null> => {
  const key = parseBookKey(item.bookKey);
  if (key) {
    try {
      return await getMetadataBookInfo(key.provider, key.providerId);
    } catch (error) {
      console.warn('Could not load the downloaded book, searching instead:', error);
    }
  }
  const format = item.contentType?.toLowerCase().includes('audio') ? 'audiobook' : 'ebook';
  const author = item.author && item.author !== 'Unknown author' ? item.author : '';
  const result = await searchMetadata(
    `${item.title} ${author}`.trim(),
    10,
    'relevance',
    {},
    1,
    format,
  );
  return (
    result.books.find((candidate) =>
      isSameBook(
        { title: candidate.title, authors: candidate.authors ?? [candidate.author] },
        item.title,
        author || null,
      ),
    ) ?? null
  );
};
