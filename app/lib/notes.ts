// Shared by the Lesson page's form schema and the service, so the cap a
// Student is told about is the cap the database write enforces.
export const MAX_NOTE_LENGTH = 2000;

export const NOTE_TOO_LONG_ERROR = `Notes must be ${MAX_NOTE_LENGTH.toLocaleString("en-US")} characters or fewer.`;
