const parsePositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
};

export const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || "2mb";
export const URLENCODED_BODY_LIMIT =
  process.env.URLENCODED_BODY_LIMIT || "2mb";

export const EVENT_FILE_SIZE_LIMIT_BYTES = parsePositiveInt(
  process.env.EVENT_FILE_SIZE_LIMIT_BYTES,
  5 * 1024 * 1024,
);
export const EVENT_FIELD_SIZE_LIMIT_BYTES = parsePositiveInt(
  process.env.EVENT_FIELD_SIZE_LIMIT_BYTES,
  1024 * 1024,
);
export const EVENT_FILE_COUNT_LIMIT = parsePositiveInt(
  process.env.EVENT_FILE_COUNT_LIMIT,
  8,
);
export const EVENT_FIELD_COUNT_LIMIT = parsePositiveInt(
  process.env.EVENT_FIELD_COUNT_LIMIT,
  40,
);
export const EVENT_PART_COUNT_LIMIT = parsePositiveInt(
  process.env.EVENT_PART_COUNT_LIMIT,
  60,
);

export const formatBytes = (value: number) => {
  if (value >= 1024 * 1024) {
    const mb = value / (1024 * 1024);
    return Number.isInteger(mb) ? `${mb} MB` : `${mb.toFixed(1)} MB`;
  }
  if (value >= 1024) {
    const kb = value / 1024;
    return Number.isInteger(kb) ? `${kb} KB` : `${kb.toFixed(1)} KB`;
  }
  return `${value} B`;
};
