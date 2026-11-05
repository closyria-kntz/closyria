# Chantier 2a — Garder : plan d'implémentation

> **Pour les agents :** sous-skill requis : `superpowers:subagent-driven-development` (recommandé) ou
> `superpowers:executing-plans`, tâche par tâche. Les étapes utilisent des cases à cocher (`- [ ]`).

**But :** une utilisatrice garde un article en un geste depuis la fiche, le retrouve dans ses vues, le fait avancer
d'étape en étape (dates et montants), le range par profils, étiquettes et listes partageables, avec ses photos
privées ; l'admin voit et corrige les fiches et gère les listes de référence ; le site est aussi bien adapté à
l'ordinateur qu'au téléphone et à la tablette.

**Architecture :** nouvelles tables appartenant à l'utilisatrice (profils, articles, événements, photos, listes,
étiquettes) rattachées aux fiches communes du chantier 1 ; routes `/api/me/…` cloisonnées par compte ; classement
des fiches par mots-clés (`packages/shared/classify`) appelé par le worker ; écrans web refaits sur une coque
adaptative (barre d'onglets sur téléphone, menu latéral sur ordinateur).

**Stack :** celle des chantiers 0 et 1 (Node 26, pnpm 12, TypeScript 7, Hono 4.13 + zod-openapi, Next 16.4,
Tailwind 4.3 par tokens, Drizzle 0.45, PostgreSQL 18, pg-boss 12, Vitest 5, Playwright 1.64 + axe).

**Spec :** `docs/specs/2026-11-05-chantier-2a-garder.md`. Contexte : `docs/specs/2026-11-05-chantier-1-capture-boutiques.md`,
`docs/specs/2026-11-01-v1-conception.md`, `docs/specs/2026-11-01-direction-visuelle.md`.

**Branche :** worktree `chantier-2a` créé depuis `dev`.

## Contraintes globales

- Code en anglais, interface et documentation en français ; textes dans `packages/i18n/messages/fr.json` seulement
  (`en`/`es` restent `{}` tant que ces langues ne sont pas activées).
- Toute donnée qui traverse une frontière est validée avec Zod ; schémas partagés dans `packages/shared`.
- Aucune valeur de style en dur dans `apps/web` (`pnpm lint` vérifie les tokens) ; photo toujours entière, cadre 3:4,
  fond `media-backdrop` (direction visuelle §6).
- Montants en centimes, devise de la fiche (`EUR` par défaut) ; dates `timestamptz` en UTC.
- Étapes exactes : `spotted`, `ordered`, `owned`, `for_sale`, `sold`, `returned` ; tout passage d'une étape à une
  autre est permis (avancer ou reculer), jamais vers la même étape.
- Public exact : `women`, `men`, `child` (+ `child_detail` : `girl`, `boy`, `baby`), `mixed`. Saisons : `summer`,
  `winter`, `mid`, `all`.
- Plafonds exacts : 10 photos par article ; 200 articles par action en lot ; 300 articles créés par heure et par
  compte ; 48 articles par page ; profil 1–40 caractères ; liste 1–80 ; étiquette 1–40 ; `size_label` ≤ 40 ;
  `size_note` ≤ 200 ; `notes` ≤ 2 000 ; `sale_channel` ≤ 60 ; « Annuler » 8 s ; corbeille 30 jours.
- Cloisonnement : toute route `/api/me/…` répond **404** (jamais 403) pour une ressource d'un autre compte.
- Jeton de partage : 128 bits aléatoires (base64url), seule l'empreinte SHA-256 est stockée.
- Adaptation aux écrans : téléphone < 48 rem, tablette 48–64 rem, ordinateur ≥ 64 rem (tokens
  `breakpoint.md` / `breakpoint.lg` existants) ; contenu jusqu'à ≈ 90 rem ; texte courant ≤ 70 caractères par ligne ;
  cibles tactiles ≥ 44 px.
- Aucun accès Internet dans les tests ; jamais les ports 3000, 3001, 3100, 3101.
- Commits avec `-c user.name=closyria-kntz -c user.email=275480081+closyria-kntz@users.noreply.github.com`, terminés
  par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `pnpm format`, `pnpm lint`, `pnpm typecheck` et **le `pnpm test` complet** passent avant chaque commit.

## Points de vigilance (non couverts par la spec, testés dans la tâche indiquée)

1. **Même fiche gardée depuis un autre profil** → l'API renvoie l'article existant (aucun doublon) avec son profil
   actuel ; la page l'indique (« Déjà dans le profil Léa ») (tâches 6 et 14).
2. **Restaurer depuis la corbeille alors qu'un article actif existe pour la même fiche** → les deux sont réunis
   (étape la plus avancée, photos, listes, étiquettes et événements réunis), sans erreur 500 (tâche 6).
3. **Liste partagée contenant un article ensuite supprimé, déplacé ou passé à « Vendu »** → la page partagée ne
   montre que les articles non supprimés de la liste, quelle que soit leur étape ; partage coupé → 404 (tâche 8).
4. **Fusion anonyme → compte quand les deux ont un article pour la même fiche et des étiquettes de même nom** →
   aucun doublon, rien de perdu (tâche 10).
5. **Fiche saisie à la main sans prix ni photo** (enseigne bloquée) → vignette de remplacement aux tokens et « Prix
   non renseigné » dans les vues et la liste partagée, jamais « NaN € » ni image cassée (tâches 14 et 15).

---

### Task 1: Schémas partagés du 2a

**Files:**
- Create: `packages/shared/src/wardrobe.ts`, `packages/shared/src/wardrobe.test.ts`
- Modify: `packages/shared/src/index.ts`, `packages/shared/src/events.ts` (+ son test)

**Interfaces:**
- Produces (Zod + types) :
  - Énumérations : `itemStageSchema`, `audienceSchema`, `childDetailSchema`, `seasonSchema`, `itemEventTypeSchema`
    (`stage|profile`), `classifiedBySchema` (`rule|admin`), `profileColorSchema` (noms de tokens de la palette :
    `plum`, `rose`, `sage`, `sand`, `sky`, `slate`).
  - `ITEM_STAGE_ORDER` : `spotted` < `ordered` < `owned` < `for_sale` < `sold`, `returned` au rang de `owned`
    (sert à « l'étape la plus avancée » lors des fusions).
  - Entrées : `profileInputSchema`, `itemCreateSchema` (`productId`, `profileId?`, `action`:
    `favorite|list|ordered`, `wishlistId?` requis si `list`), `itemPatchSchema` (favori, taille, note, notes,
    corrections, vignette), `itemStageInputSchema` (`stage`, `at`, `amountCents?`, `channel?`), `itemMoveSchema`,
    `itemBulkSchema` (`ids` 1–200, `op` : `stage` | `addToList` | `removeFromList` | `move` | `addTag` |
    `removeTag` | `delete` | `restore` | `setFavorite`), `tagInputSchema`, `wishlistInputSchema`,
    `itemListQuerySchema` (filtres de la spec §6 + `cursor`).
  - Vues : `profileViewSchema`, `itemViewSchema` (article + fiche résolue : nom/marque effectifs = correction sinon
    fiche ; prix et tailles de la fiche ; photos = privées puis boutique ; `coverUrl`), `itemPageSchema`
    (`items`, `nextCursor`), `wishlistViewSchema`, `sharedWishlistViewSchema` (contenu G4 seulement),
    `mutationResultSchema` (`undo`: `itemBulkSchema` ou `null`).
- `eventNames` gagne : `item_saved`, `item_stage_changed`, `item_moved`, `wishlist_shared`, `account_prompt_shown`,
  `account_created_from_prompt`.

- [ ] **Étape 1 : tests qui échouent** — étapes et publics exacts ; `itemCreateSchema` refuse `action: "list"` sans
  `wishlistId` ; `itemBulkSchema` refuse 201 ids ; `itemStageInputSchema` refuse une date invalide ;
  `sharedWishlistViewSchema` n'a aucune clé `notes`, `sizeLabel`, `profile`, `media` (vérifié sur `.shape`) ;
  `ITEM_STAGE_ORDER.sold > ITEM_STAGE_ORDER.owned`.
- [ ] **Étape 2 :** `pnpm --filter @closyria/shared test` → ÉCHEC.
- [ ] **Étape 3 :** implémenter.
- [ ] **Étape 4 :** tests au vert.
- [ ] **Étape 5 :** commit `feat(shared): wardrobe schemas`.

### Task 2: Listes de référence et enrichissement des fiches (base)

**Files:**
- Create: `packages/db/src/schema/reference.ts`, migration générée `0011_reference_and_product_fields`
- Modify: `packages/db/src/schema/catalog.ts`, `packages/db/src/schema/index.ts`, `packages/testing/src/catalog.integration.test.ts`

**Interfaces:**
- Produces : tables `categories` (`parent_id` → `categories`, `slug` unique, `name`, `position`, `keywords`
  `text[]` défaut `{}`), `colors` (+ `hex` `#RRGGBB`), `materials`, `patterns` (`slug` unique, `name`, `keywords`).
- `products` gagne : `published_at`, `gtin`, `sku`, `shop_data` jsonb (défaut `{}`), `audience`, `child_detail`,
  `category_id`, `color_id`, `material_id`, `pattern_id`, `season`, `classified_by` (défaut `rule`), avec `CHECK`
  construits depuis les énumérations de la tâche 1 ; suppressions de référence → `set null`.
- Migration générée (`pnpm --filter @closyria/db generate`), jamais écrite à la main.

- [ ] **Étape 1 : test d'intégration qui échoue** — insertion d'une catégorie enfant ; `audience = 'kids'` refusé ;
  supprimer une couleur met `products.color_id` à null ; `shop_data` vaut `{}` par défaut.
- [ ] **Étape 2 :** le test échoue.
- [ ] **Étape 3 :** schéma, génération, relecture du SQL.
- [ ] **Étape 4 :** tests au vert (`pnpm test` complet).
- [ ] **Étape 5 :** commit `feat(db): reference lists and product classification fields`.

### Task 3: Tables de l'utilisatrice (base)

**Files:**
- Create: `packages/db/src/schema/wardrobe.ts`, migration générée `0012_wardrobe`
- Modify: `packages/db/src/schema/index.ts`, `packages/testing/src/catalog.integration.test.ts` (ou nouveau `wardrobe.integration.test.ts` dans `packages/testing`)

**Interfaces:**
- Produces : `profiles`, `items`, `item_events`, `item_media`, `wishlists`, `wishlist_items`, `tags`, `item_tags`,
  exactement comme la spec §3, avec :
  - `user_id` → `user.id` **ON DELETE CASCADE** sur `profiles`, `items`, `wishlists`, `tags` ;
  - `items.profile_id` → `profiles` (no action : un profil non vide ne se supprime pas) ;
  - `items.product_id` → `products` (no action) ; `item_media.media_id` → `media` (cascade) ;
  - enfants de `items` / `wishlists` / `tags` en cascade ;
  - index unique partiel `items (user_id, product_id) WHERE deleted_at IS NULL` ;
  - unique `tags (user_id, lower(name))` ; `CHECK` de longueurs et d'énumérations (tâche 1).

- [ ] **Étape 1 : test d'intégration qui échoue** — deux articles actifs pour la même fiche refusés, mais un
  supprimé + un actif acceptés ; supprimer l'utilisatrice supprime profils, articles, événements, listes,
  étiquettes ; supprimer un profil qui a un article est refusé ; `stage = 'gone'` refusé.
- [ ] **Étape 2 :** le test échoue.
- [ ] **Étape 3 :** schéma, génération, relecture.
- [ ] **Étape 4 :** tests au vert (le test `owned-tables` de l'API échouera jusqu'à la tâche 10 : l'y ajouter dès
  maintenant en `NOT_OWNED` provisoire est interdit — enregistrer plutôt les quatre tables comme possédées par la
  voie générique dans `apps/api/src/owned-tables.ts`, la tâche 10 remplacera par les fusions).
- [ ] **Étape 5 :** commit `feat(db): wardrobe tables`.

### Task 4: Extraction des nouveaux champs

**Files:**
- Modify: `packages/extract/src/{shopify.ts,jsonld.ts,opengraph.ts,clean.ts}`, leurs tests, `packages/extract/src/real-pages.test.ts`, `packages/shared/src/catalog.ts` (`extractedProductSchema`)

**Interfaces:**
- Produces : `ExtractedProduct` gagne `publishedAt?` (ISO), `gtin?`, `sku?`, `shopData` : `{ category?: string;
  breadcrumb?: string[]; tags?: string[]; colors?: string[]; material?: string; care?: string; collection?: string }`
  (chaque chaîne ≤ 200, tableaux ≤ 20 éléments).
- Sources : Shopify `published_at`, `product_type` → `category`, `tags`, variantes `sku`/`barcode` (première non
  vide) ; JSON-LD `releaseDate`, `gtin13|gtin8|gtin|gtin12|gtin14`, `sku`, `color`, `material`, `category`,
  `BreadcrumbList` (noms, sans le dernier s'il égale le nom du produit).

- [ ] **Étape 1 : tests qui échouent** — sur les pages réelles enregistrées : chaque fiche Shopify a `publishedAt` et
  `shopData.category` ; la page Zalando a un `gtin` ou un `sku` et un `breadcrumb` non vide ; un `gtin` de 14 chiffres
  avec espaces est nettoyé ; un JSON-LD sans ces champs reste valide.
- [ ] **Étape 2 :** les tests échouent.
- [ ] **Étape 3 :** implémenter (couverture ≥ 90 % maintenue).
- [ ] **Étape 4 :** tests au vert.
- [ ] **Étape 5 :** commit `feat(extract): publication date, codes and shop data`.

### Task 5: Classement par mots-clés, listes de départ, branchement au worker

**Files:**
- Create: `packages/shared/src/classify.ts`, `packages/shared/src/classify.test.ts`, `apps/worker/src/capture/starting-reference.ts`, `apps/worker/src/capture/seed-reference.ts` (+ test)
- Modify: `apps/worker/src/capture/run-capture.ts` (+ test), `apps/worker/src/index.ts`

**Interfaces:**
- Produces : `classify(input: { name: string; url: string; shopData: ShopData }, ref: ReferenceSet) =>
  Classification` où `ReferenceSet = { categories: {id, parentId, keywords}[]; colors; materials; patterns }` et
  `Classification = { audience?, childDetail?, categoryId?, colorId?, materialId?, patternId?, season? }`.
  - Texte cherché, en minuscules sans accents, mots entiers : fil d'Ariane, catégorie de la boutique, nom, mots-clés
    de la boutique, chemin de l'adresse.
  - Catégorie : la plus **profonde** dont un mot-clé apparaît ; à égalité, la première trouvée dans l'ordre fil
    d'Ariane → catégorie → nom.
  - Public : `/femme|women|woman|dame/` → `women`, `/homme|men|man/` → `men`, `/enfant|kids|fille|garçon|bébé|baby/`
    → `child` (+ détail), sinon rien ; jamais deviné du seul nom.
  - Saison : mots-clés `été|summer|maillot` → `summer`, `hiver|winter|doudoune|manteau` → `winter`.
- `seedReference(db)` : insère les entrées absentes de `STARTING_REFERENCE` (par `slug`), sans jamais modifier une
  entrée existante ; appelé au démarrage du worker. `STARTING_REFERENCE` : arbre Vêtements (Robes > Robe courte,
  Robe longue ; Hauts > T-shirts, Chemises et blouses, Pulls et gilets ; Bas > Pantalons, Jeans, Jupes, Shorts ;
  Vestes et manteaux ; Combinaisons ; Maillots de bain ; Lingerie et nuit), Chaussures (Baskets, Bottines et bottes,
  Escarpins, Sandales, Ballerines), Sacs, Accessoires (Bijoux, Ceintures, Écharpes et foulards, Chapeaux et
  bonnets) ; 16 couleurs (noir, blanc, écru, gris, beige, camel, marron, rouge, bordeaux, rose, orange, jaune, vert,
  bleu, marine, violet) ; matières (coton, lin, laine, cachemire, soie, viscose, polyester, cuir, denim, maille) ;
  motifs (uni, rayé, à carreaux, fleuri, à pois, imprimé animal, imprimé) ; mots-clés français et anglais.
- `runCapture` : après une capture réussie, si `classified_by = 'rule'`, applique `classify` aux champs de la fiche
  (et enregistre `published_at`, `gtin`, `sku`, `shop_data`) ; ne touche jamais une fiche `classified_by = 'admin'`.

- [ ] **Étape 1 : tests qui échouent** — « Robe longue fleurie » dans « Femme > Robes » → Robe longue, fleuri,
  `women` ; « Jean Mahaut à pois » → Jeans, à pois ; adresse `/kids/` → `child` ; un nom contenant « menthe » ne donne
  pas `men` (mot entier) ; seed deux fois → aucun ajout la 2ᵉ fois, une entrée renommée par l'admin intacte ;
  capture sur fiche `admin` → rangement inchangé.
- [ ] **Étape 2 :** les tests échouent.
- [ ] **Étape 3 :** implémenter.
- [ ] **Étape 4 :** tests au vert (`pnpm test` complet).
- [ ] **Étape 5 :** commit `feat: keyword classification and starting reference lists`.

### Task 6: API — profils et articles

**Files:**
- Create: `apps/api/src/wardrobe/{profiles.ts,items.ts,item-view.ts,events.ts}`, `apps/api/src/routes/me/{profiles.ts,items.ts}` et leurs `*.integration.test.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/src/bootstrap.ts`

**Interfaces:**
- Consumes : schémas de la tâche 1, tables des tâches 2-3, limiteur `rateLimit`, `trackServer`.
- Produces :
  - `ensureDefaultProfile(db, userId): Promise<Profile>` — crée « Moi » (`audience` `women`, couleur `plum`) s'il
    n'existe aucun profil ; appelée par toute route `me` qui a besoin d'un profil.
  - `loadItemView(db, userId, itemId): Promise<ItemView | null>` et `listItems(db, userId, query): Promise<ItemPage>`
    (pagination par curseur `(created_at, id)` décroissant, 48 par page ; tri `price` sur le prix de la fiche).
  - `recordEvent(tx, item, event)` : écrit `item_events`.
  - Routes (`defineAccess(…, "user")`) : `GET/POST /api/me/profiles`, `PATCH/DELETE /api/me/profiles/:id`
    (`DELETE` → 409 `{ error: "profile_not_empty" }`), `POST /api/me/profiles/order` ; `POST /api/me/items`
    (201 créé, 200 si un article actif existe déjà pour la fiche — renvoyé tel quel), `GET /api/me/items`,
    `GET/PATCH /api/me/items/:id`, `POST /api/me/items/:id/stage`, `POST /api/me/items/:id/move`,
    `DELETE /api/me/items/:id` (corbeille), `POST /api/me/items/:id/restore`, `GET /api/me/summary`
    (`{ isAnonymous, itemCount, profiles }`, pour la coque et la proposition de compte).
  - Chaque mutation renvoie `mutationResultSchema` (`undo` = l'opération inverse en `itemBulkSchema`).
  - Restauration : si un autre article actif existe pour la même fiche, fusion (règle de la spec §3) puis renvoi de
    l'article réuni.
  - Événements d'audience : `item_saved`, `item_stage_changed`, `item_moved` via `trackServer`.
  - Limite : 300 créations d'articles par heure et par compte → 429 `rate_limited`.

- [ ] **Étape 1 : tests d'intégration qui échouent** — profil « Moi » créé au premier appel ; ♡ crée `spotted`
  favori ; `ordered` crée `ordered` + événement ; deuxième `POST` sur la même fiche depuis un autre profil → 200 avec
  l'article existant (point de vigilance 1) ; `stage` écrit l'événement avec date et montant ; `move` écrit
  `from/to` ; supprimer un profil non vide → 409 ; **chaque route** sur l'article / profil d'une autre utilisatrice →
  404 ; corbeille puis restauration avec un actif pour la même fiche → réunis (point de vigilance 2) ; pagination
  stable sur 120 articles ; 301ᵉ création dans l'heure → 429 ; `undo` d'un `stage` rétablit l'étape.
- [ ] **Étape 2 :** les tests échouent.
- [ ] **Étape 3 :** implémenter.
- [ ] **Étape 4 :** tests au vert (`pnpm test` complet).
- [ ] **Étape 5 :** commit `feat(api): profiles and items`.

### Task 7: API — actions en lot, étiquettes

**Files:**
- Create: `apps/api/src/routes/me/{bulk.ts,tags.ts}` et tests
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Consumes : tâche 6.
- Produces : `POST /api/me/items/bulk` (une transaction, tout ou rien ; ids d'autrui ou inconnus → 404 pour tout le
  lot ; renvoie `undo`) ; `GET/POST /api/me/tags`, `PATCH/DELETE /api/me/tags/:id` (supprimer une étiquette la
  retire des articles, les articles restent) ; nom d'étiquette en double (casse ignorée) → 409 `tag_exists`.

- [ ] **Étape 1 : tests qui échouent** — lot de 200 `move` + un `undo` qui rétablit chaque profil d'origine ; lot de
  201 → 400 ; lot contenant un id d'autrui → 404 et rien de modifié ; `addTag` puis suppression de l'étiquette ;
  `delete` puis `restore` en lot ; doublon d'étiquette « Vinted » / « vinted » → 409.
- [ ] **Étape 2 :** les tests échouent.
- [ ] **Étape 3 :** implémenter.
- [ ] **Étape 4 :** tests au vert.
- [ ] **Étape 5 :** commit `feat(api): bulk item actions and tags`.

### Task 8: API — listes et partage

**Files:**
- Create: `apps/api/src/routes/me/wishlists.ts`, `apps/api/src/routes/shared.ts`, `apps/api/src/wardrobe/share-token.ts` et tests
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Produces : `GET/POST /api/me/wishlists`, `PATCH/DELETE /api/me/wishlists/:id`, `POST /api/me/wishlists/:id/items`
  (`{ itemId }`), `DELETE /api/me/wishlists/:id/items/:itemId`, `POST /api/me/wishlists/:id/order` ;
  `POST /api/me/wishlists/:id/share` → `{ url: "/listes/<jeton>" }` (nouveau jeton à chaque fois, l'ancien ne marche
  plus) ; `DELETE …/share` ; `GET /api/shared/:token` (`public`, en-tête `X-Robots-Tag: noindex`) →
  `sharedWishlistViewSchema` ; `newShareToken(): { token, hash }`, `hashShareToken(token): string`.
- Événement `wishlist_shared`.

- [ ] **Étape 1 : tests qui échouent** — la page partagée ne contient ni notes, ni taille, ni profil, ni photo
  privée (comparaison de clés sur la réponse brute) ; article supprimé absent, article passé à « Vendu » toujours
  présent (point de vigilance 3) ; repartager invalide l'ancien jeton ; partage coupé → 404 ; jeton mal formé → 404 ;
  la base ne contient jamais le jeton en clair ; fiche sans prix → `priceCents: null` (point de vigilance 5).
- [ ] **Étape 2 :** les tests échouent.
- [ ] **Étape 3 :** implémenter.
- [ ] **Étape 4 :** tests au vert.
- [ ] **Étape 5 :** commit `feat(api): wishlists and sharing`.

### Task 9: API — photos de l'article

**Files:**
- Create: `apps/api/src/routes/me/item-media.ts` et test
- Modify: `apps/api/src/app.ts`, `apps/api/src/routes/media.ts` si une fonction de réencodage doit être partagée

**Interfaces:**
- Produces : `POST /api/me/items/:id/media` (multipart, même réencodage et mêmes limites que `POST /api/media`,
  rattache la photo ; 11ᵉ photo → 409 `too_many_photos`) ; `DELETE /api/me/items/:id/media/:mediaId` (retire et
  supprime la photo ; si c'était la vignette, `cover_media_id` repasse à null) ; `GET /api/me/media/:id` (la photo
  privée, seulement pour sa propriétaire, `Cache-Control: private, max-age=86400`).

- [ ] **Étape 1 : tests qui échouent** — envoi d'une photo → visible dans `GET /api/me/items/:id` ; métadonnées GPS
  absentes du fichier stocké ; 11ᵉ photo → 409 ; photo d'autrui → 404 ; suppression de la vignette → `coverUrl`
  redevient la première photo de la boutique.
- [ ] **Étape 2 :** les tests échouent.
- [ ] **Étape 3 :** implémenter.
- [ ] **Étape 4 :** tests au vert.
- [ ] **Étape 5 :** commit `feat(api): private item photos`.

### Task 10: Fusion anonyme → compte

**Files:**
- Create: `apps/api/src/wardrobe/merge.ts`, `apps/api/src/wardrobe/merge.integration.test.ts`
- Modify: `apps/api/src/owned-tables.ts`, `apps/api/src/owned-tables.test.ts`

**Interfaces:**
- Consumes : `registerOwnedTable(table, column, reassign)` (`packages/auth/src/owned-data.ts`) — l'ordre
  d'enregistrement est l'ordre d'exécution : `profiles`, puis `tags`, puis `items`, puis `wishlists`.
- Produces : quatre fonctions `reassign` :
  - profils : « Moi » (le plus ancien profil) de l'anonyme fusionné dans celui du compte (articles rattachés), les
    autres déplacés ;
  - étiquettes : même nom (casse ignorée) → fusionnées, sinon déplacées ;
  - articles : même fiche active des deux côtés → étape la plus avancée (`ITEM_STAGE_ORDER`), favori si l'un l'est,
    taille / notes / montants du compte gardés s'ils existent, photos, listes, étiquettes et événements réunis ;
    sinon déplacés ;
  - listes : déplacées (noms identiques gardés tels quels).

- [ ] **Étape 1 : tests qui échouent** — scénario complet du point de vigilance 4 ; aucune ligne orpheline ;
  l'anonyme supprimé après fusion ne laisse rien ; le test `owned-tables` exige toujours la cascade.
- [ ] **Étape 2 :** les tests échouent.
- [ ] **Étape 3 :** implémenter.
- [ ] **Étape 4 :** tests au vert (`pnpm test` complet).
- [ ] **Étape 5 :** commit `feat(api): merge wardrobe on sign-in`.

### Task 11: Admin — fiches et listes de référence (API)

**Files:**
- Create: `apps/api/src/routes/admin/{products.ts,reference.ts}` et tests
- Modify: `apps/api/src/app.ts`, `packages/shared/src/admin.ts`

**Interfaces:**
- Produces (toutes `admin`, journalisées) : `GET /api/admin/products?q=&shopId=&captureStatus=&classified=&cursor=`
  (avec `keptBy` = **nombre** d'articles actifs, jamais d'identifiant d'utilisatrice), `GET /api/admin/products/:id`
  (fiche, photos, dates, `shop_data`, rangement, `keptBy`), `PATCH /api/admin/products/:id` (nom, marque, prix,
  public, type, couleur, matière, motif, saison → `classified_by = 'admin'`), `POST /api/admin/products/:id/recapture` ;
  `GET/POST/PATCH/DELETE /api/admin/reference/{categories|colors|materials|patterns}[/:id]` (catégorie : déplacer vers
  un autre parent refusé s'il crée un cycle → 400 `cycle`).

- [ ] **Étape 1 : tests qui échouent** — non-admin → 403 partout ; `keptBy` compte 2 pour deux utilisatrices et la
  réponse ne contient aucun `userId` ; `PATCH` passe `classified_by` à `admin` et une capture suivante ne change pas
  le rangement ; cycle de catégories refusé ; chaque mutation écrit dans le journal admin.
- [ ] **Étape 2 :** les tests échouent.
- [ ] **Étape 3 :** implémenter.
- [ ] **Étape 4 :** tests au vert.
- [ ] **Étape 5 :** commit `feat(api): product and reference administration`.

### Task 12: Worker — vidage de la corbeille

**Files:**
- Create: `apps/worker/src/wardrobe/purge-trash.ts` et test
- Modify: `apps/worker/src/index.ts`

**Interfaces:**
- Produces : `purgeTrash(db, now: Date, store: ObjectStore): Promise<number>` — supprime définitivement les articles
  dont `deleted_at` a plus de 30 jours (photos privées comprises, objets du stockage compris) ; file
  `wardrobe-purge` planifiée à `30 3 * * *`.

- [ ] **Étape 1 : test qui échoue** — article supprimé il y a 31 jours effacé avec ses photos (objets absents du
  stockage en mémoire) ; supprimé il y a 29 jours gardé ; article actif jamais touché.
- [ ] **Étape 2 :** le test échoue.
- [ ] **Étape 3 :** implémenter.
- [ ] **Étape 4 :** tests au vert.
- [ ] **Étape 5 :** commit `feat(worker): purge the trash after 30 days`.

### Task 13: Web — coque adaptative et reprise des pages existantes

**Files:**
- Create: `apps/web/src/components/app-shell.tsx`, `apps/web/src/components/profile-switcher.tsx`, `apps/web/src/lib/profile-context.ts` (+ test)
- Modify: `packages/design-tokens/src/{primitives.ts,semantic.ts}` (+ tests), `apps/web/src/app/layout.tsx`, `apps/web/src/app/page.tsx`, `apps/web/src/app/produits/[id]/*`, `apps/web/src/app/admin/(shell)/layout.tsx`, `e2e/playwright.config.ts`

**Interfaces:**
- Tokens : `container.app` = `90rem` ; typographie fluide (`clamp()`) pour `text-body`, `text-lead`, `text-title`,
  `text-display` entre le téléphone et `breakpoint.lg` ; `measure` = `70ch` ; `touch-target` = `44px`.
- `AppShell` : téléphone → barre d'onglets en bas (Envies, Commandé, Dressing, Plus) ; tablette → onglets en haut ;
  ordinateur → menu latéral (Envies, Commandé, Dressing, À vendre, Listes, Réglages). En-tête : sélecteur de profil
  et « + Ajouter » (ouvre le champ « Coller un lien »).
- Profil courant : paramètre `?profil=<id>` dans l'adresse, sinon « Moi » ; `useCurrentProfile()`.
- Pages reprises : accueil (le champ de capture occupe une largeur confortable sur ordinateur), fiche (deux
  colonnes ≥ 48 rem en paysage et sur ordinateur : galerie à gauche, informations à droite), admin (contenu jusqu'à
  `container.app`).
- E2E : nouveau projet « iPad (gen 7) » (Playwright `devices["iPad (gen 7)"]`).

- [ ] **Étape 1 : tests qui échouent** — tests des tokens (les `clamp()` existent, `container.app` = `90rem`) ;
  `profile-context` lit `?profil=` et retombe sur « Moi » ; test e2e de mise en page : à 1440 px la fiche affiche
  deux colonnes et le contenu dépasse 60 rem de large ; à 390 px la barre d'onglets est visible en bas ; à 820 px les
  onglets sont en haut.
- [ ] **Étape 2 :** les tests échouent.
- [ ] **Étape 3 :** implémenter.
- [ ] **Étape 4 :** tests, `pnpm lint` (tokens), build et `pnpm e2e` au vert.
- [ ] **Étape 5 :** commit `feat(web): responsive app shell`.

### Task 14: Web — de la fiche à l'article

**Files:**
- Create: `apps/web/src/app/produits/[id]/{keep-actions.tsx,item-panel.tsx,stage-dialog.tsx,photo-manager.tsx}`, `apps/web/src/lib/wardrobe-client.ts` (+ test), `apps/web/src/components/undo-toast.tsx`, `apps/web/src/lib/undo.ts` (+ test)
- Modify: `apps/web/src/app/produits/[id]/product-view.tsx`, `packages/i18n/messages/fr.json`

**Interfaces:**
- Consumes : routes des tâches 6 à 9.
- `wardrobe-client.ts` : fonctions typées pour chaque route `me`, réponses validées par les schémas de la tâche 1.
- `undo.ts` : `pushUndo(label, op)` / `runUndo()` — garde la dernière opération 8 s ; le toast l'affiche
  (« … · Annuler »).
- Fiche non gardée : **♡ Favori** · **Ajouter à une liste** · **Je l'ai commandé**. Gardée : panneau article (photos
  privées puis boutique, choix de la vignette, frise d'étapes, taille et note, montants, notes, listes, étiquettes,
  profil avec « Déplacer vers… », « Supprimer »). Déjà gardée dans un autre profil : bandeau « Déjà dans le profil
  {nom} » (point de vigilance 1).
- Fenêtre d'étape : date (aujourd'hui par défaut), montant facultatif ; pour « À vendre » prix demandé et endroit.
- Fiche sans prix → « Prix non renseigné » ; sans photo → vignette de remplacement aux tokens (point de vigilance 5).

- [ ] **Étape 1 : tests qui échouent** — `undo` expire après 8 s (horloge simulée) ; `wardrobe-client` refuse une
  réponse mal formée ; formatage « Prix non renseigné » pour `priceCents: null`.
- [ ] **Étape 2 :** les tests échouent.
- [ ] **Étape 3 :** implémenter.
- [ ] **Étape 4 :** tests, lint, build au vert.
- [ ] **Étape 5 :** commit `feat(web): keep an item from its sheet`.

### Task 15: Web — vues, filtres, sélection multiple, proposition de compte

**Files:**
- Create: `apps/web/src/app/(app)/{envies,commande,dressing,a-vendre}/page.tsx`, `apps/web/src/components/{item-grid.tsx,item-card.tsx,filters-bar.tsx,selection-bar.tsx,account-prompt.tsx}`, `apps/web/src/lib/account-prompt.ts` (+ test)
- Modify: `packages/i18n/messages/fr.json`

**Interfaces:**
- Vues : Envies = `spotted`, Commandé = `ordered`, Dressing = `owned`, À vendre = `for_sale` ; filtre « Étape » pour
  `sold` / `returned`. Grille : 2 colonnes < 48 rem, 3–4 entre 48 et 64 rem, 5–6 au-delà ; défilement infini par
  curseur (48).
- Filtres : favori, boutique, type, couleur, public, étiquette ; tri date d'ajout / prix ; état dans l'adresse.
- Sélection multiple : étape, liste, profil, étiquette, supprimer (via `/items/bulk`, avec « Annuler »).
- `shouldPromptAccount(state: { isAnonymous; itemCount; trigger: "save"|"share"|"photo"; dismissedAt? }): boolean`
  — vrai si anonyme et (`itemCount >= 3` après un gardé, ou `share`, ou `photo`), et pas refermé depuis moins de
  7 jours (date de fermeture dans `localStorage`, lecture protégée). Événements `account_prompt_shown`,
  `account_created_from_prompt`.

- [ ] **Étape 1 : tests qui échouent** — `shouldPromptAccount` : 2ᵉ article → non, 3ᵉ → oui, partage → oui même au
  1ᵉʳ article, compte non anonyme → jamais, refermé hier → non ; `localStorage` qui lève une erreur → pas de plantage.
- [ ] **Étape 2 :** les tests échouent.
- [ ] **Étape 3 :** implémenter.
- [ ] **Étape 4 :** tests, lint, build au vert.
- [ ] **Étape 5 :** commit `feat(web): wardrobe views`.

### Task 16: Web — listes, page partagée, réglages, aide iPhone

**Files:**
- Create: `apps/web/src/app/(app)/listes/{page.tsx,[id]/page.tsx}`, `apps/web/src/app/listes/[token]/page.tsx` (publique), `apps/web/src/app/(app)/reglages/{profils,etiquettes,corbeille}/page.tsx`, `apps/web/src/app/aide/iphone/page.tsx`
- Modify: `packages/i18n/messages/fr.json`, `apps/web/src/security-headers.ts` si nécessaire

**Interfaces:**
- Listes : créer, renommer, réordonner (boutons monter / descendre, accessibles au clavier), supprimer, « Partager »
  (copie du lien, `navigator.clipboard` dans un gestionnaire de clic, repli : champ sélectionné), « Arrêter le
  partage ».
- Page publique `/listes/<jeton>` : rendue côté serveur, `<meta name="robots" content="noindex">`, contenu G4 ;
  404 si le jeton ne marche plus.
- Réglages : profils (nom, public, couleur, ordre, suppression seulement s'il est vide — message « Déplace d'abord
  ses articles »), étiquettes, corbeille (restaurer, supprimer définitivement, « Effacés automatiquement après
  30 jours »).
- Aide iPhone : étapes illustrées pour installer le Raccourci « Envoyer à Closyria », qui ouvre
  `https://closyria.com/partager?url=<lien>` ; le fichier du raccourci n'est pas dans le dépôt : la page explique
  comment le créer en 4 étapes (action « Ouvrir les URL » sur l'entrée de partage).

- [ ] **Étape 1 : tests qui échouent** — unitaires des fonctions de mise en forme (lien de partage absolu depuis
  `{ url }`) ; la page publique renvoie 404 pour un jeton inconnu (test de route Next ou e2e de la tâche 18).
- [ ] **Étape 2 :** les tests échouent.
- [ ] **Étape 3 :** implémenter.
- [ ] **Étape 4 :** tests, lint, build au vert.
- [ ] **Étape 5 :** commit `feat(web): lists, sharing, settings and iPhone help`.

### Task 17: Web — admin des fiches et des listes de référence

**Files:**
- Create: `apps/web/src/app/admin/(shell)/fiches/{page.tsx,[id]/page.tsx}`, `apps/web/src/app/admin/(shell)/references/page.tsx` et composants
- Modify: `apps/web/src/app/admin/nav.ts` (+ test), `apps/web/src/lib/admin-api.ts` (+ test), `packages/i18n/messages/fr.json`

**Interfaces:**
- Consumes : tâche 11.
- Fiches : liste (recherche, filtres, colonne « Gardée par » = nombre), détail (photos de la boutique, dates de mise
  en ligne / ajout / dernière lecture / modification, données brutes repliables, rangement, « Corriger la fiche »,
  « Relancer la lecture »). Pastille « Corrigée » quand `classified_by = admin`.
- Listes de référence : arbre des types (ajouter, renommer, déplacer, mots-clés séparés par des virgules), couleurs
  (avec aperçu de la teinte), matières, motifs.

- [ ] **Étape 1 : tests qui échouent** — `nav.test.ts` contient `products` et `reference` ; appels admin validés
  (`admin-api.test.ts`).
- [ ] **Étape 2 :** les tests échouent.
- [ ] **Étape 3 :** implémenter.
- [ ] **Étape 4 :** tests, lint, build au vert.
- [ ] **Étape 5 :** commit `feat(web): product and reference admin`.

### Task 18: Bout en bout et mise en service

**Files:**
- Create: `e2e/tests/{keep.spec.ts,lists.spec.ts,profiles.spec.ts,account-merge.spec.ts}`
- Modify: `docs/plans/2026-11-05-mise-en-service-chantier-1.md` (section « Chantier 2a » : migrations 0011–0012, listes
  de référence créées au démarrage, vérifications), `docs/specs/2026-11-01-v1-conception.md` (ligne du chantier 2)

**Interfaces:**
- Parcours sur les trois formats (iPhone 15, iPad, ordinateur), sans Internet (fausse boutique du chantier 1) :
  coller un lien → ♡ → présent dans Envies ; avancer jusqu'à « Dans mon dressing » avec prix payé, puis « Annuler » ;
  créer une liste, partager, ouvrir le lien dans un nouveau contexte (aucune note ni taille visible), arrêter le
  partage → 404 ; créer « Léa », déplacer deux articles en lot, filtrer par profil ; anonyme avec 3 articles → bandeau
  → connexion par code e-mail → articles toujours là ; axe sur chaque nouvelle page.

- [ ] **Étape 1 :** écrire les parcours (ils échouent tant qu'une pièce manque).
- [ ] **Étape 2 :** `pnpm build && pnpm e2e` au vert sur les trois formats.
- [ ] **Étape 3 :** compléter la liste de mise en service et la conception V1.
- [ ] **Étape 4 :** commit `test(e2e): keep, lists, profiles and account merge`.

---

## Après le plan

- Revue de toute la branche, fusion dans `dev` avec l'accord de la fondatrice, déploiement en dev, tests de la
  fondatrice.
- Petit chantier « Sauvegardes automatiques de la prod », puis mise en prod des chantiers 1 et 2a ensemble.
