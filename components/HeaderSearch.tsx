import CardSearch from "@/components/CardSearch";
import { getCurrentUser } from "@/lib/auth";

/**
 * Rendu à part et sous `<Suspense>` : lire le cookie de session dans le layout
 * lui-même retarderait le premier octet de toutes les pages.
 */
export default async function HeaderSearch() {
  const user = await getCurrentUser();

  return (
    <CardSearch
      favoriteIds={(user?.favorites ?? []).map((favorite) => favorite.cardId)}
      isLoggedIn={Boolean(user)}
    />
  );
}
