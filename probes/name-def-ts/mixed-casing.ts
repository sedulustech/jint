// Convention defect: same kind, two casings.
export function getUserData(id: string) {
  return { id };
}
export function fetch_user_data(id: string) {
  return { id };
}
export class OrderItem {
  constructor(public id: string) {}
}
export class order_item {
  constructor(public id: string) {}
}
export const MAX_RETRIES = 3;
export const maxRetries = 3;
