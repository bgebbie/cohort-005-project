export const MIN_COMMENT_LENGTH = 1;
export const MAX_COMMENT_LENGTH = 5000;

/** The DOM id of a comment on its lesson page, so a link can land on it. */
export function commentAnchor(commentId: number): string {
  return `comment-${commentId}`;
}
