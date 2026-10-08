export const isValidNameString = (str) => {
  if (!str) return false;
  const trimmed = str.trim();
  if (!trimmed) return false;
  return /^[a-zA-Z0-9 _.\-]+$/.test(trimmed);
};
