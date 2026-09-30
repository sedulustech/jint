// Vocabulary defect: same concept, two words.
export interface User {
  id: string;
}
export interface Account {
  id: string;
}
export function getUser(id: string): User {
  return { id };
}
export function saveAccount(a: Account) {
  return a;
}
