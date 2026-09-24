import { VolcanoAuth } from '@volcano.dev/sdk';
let instance;
export function getVolcano() {
  if (!instance) {
    instance = new VolcanoAuth({ apiUrl: process.env.NEXT_PUBLIC_VOLCANO_API_URL, anonKey: process.env.NEXT_PUBLIC_VOLCANO_ANON_KEY });
    instance.database(process.env.NEXT_PUBLIC_VOLCANO_DATABASE);
  }
  return instance;
}
