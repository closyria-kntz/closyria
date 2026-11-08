# Refonte du design — « Cocon lumineux »

> **Statut (2026-11-08) : cahier des charges à relire par la fondatrice.** Rien n'est codé.
> Maquette de référence (vivante) : https://claude.ai/artifact/NUGp3TTwNs9jAELUm7uQgv — copie dans
> `docs/maquettes/refonte-a2.html`. Catalogue des styles et animations votés : `docs/maquettes/refonte-catalogue.html`
> (votes lus le 2026-11-08).

## 1. Pourquoi

Le site fonctionne mais « manque de personnalité ». La fondatrice veut un design plus abouti, plus travaillé et
interactif, sans perdre les infos importantes ni la douceur actuelle. Une première « Passe design » (cadre fixe,
fiche en 2 colonnes, frise, accueil à 4 cases) a été refusée en bloc le 2026-11-07 : celle-ci part de ses choix,
pris un par un sur maquettes.

**Réussi si** : la fondatrice reconnaît Closyria au premier coup d'œil, retrouve toutes ses fonctions au même
endroit avec les mêmes mots, et trouve l'ensemble « doux, lumineux, chic » en clair comme en sombre.

## 2. Décisions (validées par la fondatrice le 2026-11-08)

| # | Sujet | Décision |
|---|---|---|
| D1 | Ambiance | **Cocon doux et lumineux.** Pas « magazine éditorial » (S6 et S7 refusés au vote). |
| D2 | Styles gardés | S1 verre dépoli (menu, panneaux, bandeau), S2 pâte à modeler et S5 relief doux (esprit des boutons et pastilles, **sans ombre portée**), S3 aurore pastel (fond), S11 texte en mouvement (**annonces seulement**). |
| D3 | Photos | ~~En arche~~ → **forme C** (2026-11-08 : rectangle au haut plus arrondi, voir `docs/plans/2026-11-08-refonte-ecarts-maquette.md`), photo principale en grand, autres photos **en dessous** en petites vignettes de même forme. |
| D4 | Infos | Rangées en **blocs séparés** (l'article, ton envie, taille, avis), comme la piste « Boudoir ». |
| D5 | Couleurs | **« Le mélange des trois »** : fond rose-lavande (Rose et lavande), touches framboise (Framboise et or), boutons bordeaux et détails champagne (Bordeaux et champagne). Valeurs § 4. |
| D6 | Polices | **Fraunces** pour les titres (logo inchangé : Fraunces 600 droit), **Jost** pour le texte (remplace DM Sans). |
| D7 | Boutons | **À plat, sans ombre.** Boutons clairs avec un fin contour. |
| D8 | Émojis d'envie | **Posés seuls** sur la photo (légère ombre portée sur l'émoji), **jamais dans un rond opaque**. |
| D9 | Mouvements | Les 38 animations votées (§ 5), **un seul effet par moment** (pas de cumul onde + défilement + îlot). |
| D10 | Mode sombre | Même design, même palette en version sombre ; passage clair/sombre **sans animation**. |
| D11 | Mots | Ceux de l'app : « Je le prends », « Ma commande », « J'ai commandé », « Il te resterait… ». « Commander » n'est plus utilisé pour la sélection. |

## 3. Ce qui ne change pas

- Toutes les fonctions, les pages, les adresses et les données. La refonte est visuelle et d'interaction.
- Les mots déjà en place (sauf « Commander » → « Je le prends », D11), les niveaux d'envie de la fondatrice
  (ses émojis et ses noms), les budgets (§ 3.7 d'« Envies chaleureuses »), les avis des amies.
- L'accessibilité déjà acquise (contrastes, clavier, lecteurs d'écran, zones tactiles de 44 px) et les tests.
- Le contrôle des tokens (`check-design-tokens`) : toutes les valeurs passent par `packages/design-tokens`.

## 4. Couleurs (« le mélange des trois »)

Les rôles existants de `packages/design-tokens` gardent leur nom ; seules leurs valeurs changent. Contrastes vérifiés
(texte ≥ 4,5:1).

| Rôle (token) | Clair | Sombre | Usage |
|---|---|---|---|
| `color-surface` (fond) | `#FBF5F9` | `#1A1218` | Fond de page, sous l'aurore |
| `color-surface-raised` / `color-card-bg` | `#FFFFFF` | `#261922` | Cartes, blocs (souvent en verre, § 6) |
| `color-ink` | `#2A1A24` | `#F6EBF1` | Texte (15,4:1 / 15,8:1) |
| `color-ink-muted` | `#6A5563` | `#CBB5C2` | Texte secondaire (6,3:1 / 9,6:1) |
| `color-accent` | `#BE185D` framboise | `#F48BBE` | Onglet choisi, trait qui suit, niveau choisi, liens (5,6:1 / 8,1:1) |
| `color-button-bg` / `color-button-ink` | `#5E1E2E` bordeaux / `#FBF5F9` | `#F6EBF1` / `#1A1218` | Boutons principaux (11,5:1 / 15,8:1) |
| `color-hint` / `color-selected-surface` | `#F6D6E4` | `#47233A` | Choix pressé (niveau, filtre, taille) |
| `color-surface-sunken` / `-strong` | `#F3E6EF` / `#EFE1EB` | `#33222D` / `#2D1E28` | Pastilles, champs, survols |
| Champagne (nouveau : `color-detail`) | `#D9BC80` | `#D9BC80` | Détails décoratifs seulement (courbe des prix, reflets de l'aurore) — jamais pour du texte |
| Aurore (nouveaux : `color-aurora-1..3`) | framboise 18 %, champagne 28 %, lavande 30 % | framboise 18 %, champagne 12 %, lavande 12 % | Fond animé très lent |
| Succès, erreur, prix en baisse | inchangés (`color-success-*`, `color-danger-*`) | inchangés | Baisses de prix, « … au-dessus » |

Le bandeau « Ma commande » garde son principe (fond neutre, contour) mais en verre dépoli ; ses pastilles de budget
gardent la version B (2026-11-07).

## 5. Animations

**Règle** : un seul effet par moment ; durées courtes (moins de 300 ms pour l'interface, une seule entrée plus longue
au chargement d'une page) ; aucune animation qui tourne en boucle sur une donnée (pas d'onde permanente). Si
l'appareil demande moins d'animations (`prefers-reduced-motion`), tout s'affiche directement à son état final.

| Où | Animations retenues (n° du catalogue) |
|---|---|
| Aimer | 1 étincelles **seulement** quand on choisit 😍 ; 2 double-tap sur une photo → **ouvre les 4 niveaux** (pas de coup de cœur forcé) ; 4 compteur qui roule, pour le nombre d'articles de « Ma commande » (le marque-page n° 6, voté, n'a pas de fonction dans Closyria : non utilisé) |
| Ajouter une envie | 8 carte qui se construit ; 9 points d'attente avec « On regarde chez {boutique}… » ; 10 étiquette qui flotte |
| Prix | 13 courbe qui se dessine (une fois) ; prix affiché directement (12 abandonné après essai) ; ancien prix déjà barré (15 sans animation) ; 14 sans onde (« trop chargé ») ; 16 bulle du curseur de budget |
| Commande | 17 l'article vole vers « Ma commande » ; 20 « J'ai commandé » se resserre, tourne, confirme ; 21 coche qui se dessine ; 22 barre de budget qui se remplit |
| Listes et partage | 23 « Lien copié » ; 24 interrupteur élastique ; 27 feuille qui monte |
| Avis | 28 nouvelle bulle (sur la fiche) ; 29 pastille « 1 nouveau » **fixe** ; 31 notification en îlot **seulement si on n'est pas sur la fiche** |
| Navigation | 33 trait rose qui suit (menu, onglets de listes) ; 36 liste ↔ grille ; 37 recherche qui s'ouvre ; 38 filtres qui se cochent |
| Photos | 39 points qui s'étirent ; 41 vignettes qui grossissent ; 43 grille en cascade à l'arrivée ; la photo grandit de la grille vers la fiche |
| Messages et états | 44 silhouettes en arche qui scintillent ; 45 messages empilés ; 47 champ qui tremble + explication ; 48 bandeau hors ligne ; 49 page vide (cintre) ; 50 tirer pour actualiser (téléphone) |
| Téléphone | 53 aperçu en feuille à crans ; 54 glisser un article (droite : « Je le prends », gauche : retirer + « Annuler ») |

**Refusées au vote** (ne pas utiliser) : 3, 5, 7, 11, 11b, 18, 19, 25, 26, 30, 32, 34, 35, 40, 42, 46, 51, 55, 56,
et l'effet de cercle au passage clair/sombre.

## 6. Composants

- **Fond** : aurore pastel très lente (26 s, aller-retour) derrière toute l'app ; immobile en mouvement réduit.
- **Verre dépoli** (`backdrop-filter`) : barre du haut (pilule flottante), panneaux d'aperçu, bandeau « Ma commande »,
  feuilles, cadre des réglages. Repli : fond plein `color-surface-raised` si le navigateur ne le gère pas.
- **Barre du haut** : logo, menu avec trait framboise qui suit la rubrique, bouton thème (lune / soleil).
- **Onglets de listes** sur « Mes envies » : « Toutes mes envies », puis chaque liste, avec le nombre d'articles et le
  trait qui suit. Chaque onglet a sa sélection « Ma commande » et son budget (comme « Préparer une commande »
  depuis une liste, § 3.6 d'« Envies chaleureuses »).
- **Carte de budget** sous le titre : « Budget du mois : 500 € · Déjà commandé : 215 € · Reste 285 € » (ou
  « Dépassé de 80 € » en rouge), barre en deux couleurs (déjà commandé / commande en cours), légende ; pour une liste
  sans budget : « Pas de budget pour « Été » · Ajouter un budget » et « Ces articles comptent quand même dans ton
  budget du mois ».
- **Filtres** : pastilles qui se cochent (coche qui se dessine) ; dès un filtre actif, « Effacer le filtre » /
  « Effacer les N filtres » au bout de la ligne (efface aussi la recherche).
- **Carte d'article** : photo en arche (zoom léger au survol), émoji posé en haut à droite (clic = choisir le niveau),
  « −20 € » sur la photo s'il y a baisse, au survol « Aperçu » et « Je le prends » / « Retirer » (toujours visibles
  sur téléphone), coche bordeaux quand l'article est pris ; dessous marque, nom (Fraunces), prix, ancien prix barré,
  « Prix noté à la main » pour une boutique non lisible.
- **Choix du niveau** : bulle en verre avec les 4 émojis de la fondatrice, le niveau actuel mis en avant ; s'ouvre
  au double-tap sur une photo ou au clic sur l'émoji ; Échap ou clic à côté ferme sans rien changer.
- **Aperçu** (« Aperçu » sur une carte) : panneau en verre à droite (feuille sur téléphone) avec toutes les photos à
  faire défiler, prix et baisse, envie et priorité, taille et stock, pourquoi, avis, « Je le prends » et « Voir la
  fiche complète ». Reprend `item-preview` existant, restylé.
- **Fiche article** : galerie (grande arche, flèches, points qui s'étirent, vignettes en arches dessous), puis blocs :
  **l'article** (marque, nom, prix, ancien prix barré, courbe sur 3 mois, une seule mention de baisse : « −20 € depuis
  mardi, le plus bas depuis 3 mois ») ; **ton envie** (4 niveaux au style actuel de l'app : carte blanche, trait fin,
  choisi = bord framboise + fond `color-hint` ; « Prioritaire » avec coche ; pourquoi en italique) ; **taille** (tailles,
  stock, « Me prévenir si le prix baisse ») ; boutons « Voir chez {boutique} », « Je le prends », « Partager » ;
  **avis des amies**.
- **Boutique non lisible** (saisie manuelle) : la fiche dit « {Boutique} ne permet pas la lecture automatique : prix
  et tailles notés à la main, mis à jour le {date}. Closyria ne peut donc pas suivre le stock ni les baisses de
  prix de cette boutique. » ; tailles « notées à la main, stock non suivi » ; réglage d'alerte masqué ; pas de courbe.
- **Ma commande** (bandeau du bas, verre) : « Ma commande » (ou « Ma commande, liste « … » »), nombre d'articles qui
  roule, total, « Il te resterait … » / « … au-dessus » (rouge), barre en deux couleurs ; « Voir » déplie la liste des
  articles pris, **chacun coché** (décocher = ne compte plus) et le curseur du budget ; « J'ai commandé (N) » ne prend
  **que les cochés**, les passe en « Commandé », les déduit du budget (profil et listes qui les contiennent) et vide la
  sélection ; message « N articles passés en Commandé ». Aucune case cochée : le bouton tremble et dit « Coche au moins
  une envie ».
- **Messages** : empilés en bas (3 visibles), « Annuler » quand c'est possible.
- **Ajouter une envie** : feuille en verre, champ à étiquette qui flotte, vérification du lien (tremblement + phrase
  claire), points d'attente puis carte qui se construit, « Garder cette envie ».
- **Téléphone** : menu du bas avec trait qui suit ; glisser un article ; tirer pour actualiser ; aperçu en feuille à
  3 crans.
- **Annonces** (S11) : bandeau qui défile lentement, en italique, **seulement** pour des nouvelles (« 2 prix en baisse
  cette semaine »…), en haut de « Mes envies » et de l'accueil ; s'arrête au survol ; immobile en mouvement réduit.

## 7. Ordre de livraison (proposé, chaque étape testée en dev avant la suivante)

1. **Fondations** : nouvelles valeurs de couleurs (clair et sombre), Jost, boutons à plat, verre dépoli, aurore,
   barre du haut. Tout le site change de peau d'un coup, sans changer les pages.
2. **Mes envies** : onglets de listes, carte de budget, filtres + « Effacer », cartes en arche, choix du niveau,
   aperçu, « Ma commande » (bandeau).
3. **Fiche article** : galerie en arches, blocs, boutique non lisible, partage.
4. **Téléphone** : glisser, tirer pour actualiser, aperçu à crans, menu du bas.
5. **Le reste du site** : Dressing, Listes, lien partagé (amies), accueil, réglages, « À vendre » — mêmes composants.
6. **Relecture** (interface-design + règles web) puis mise en prod sur accord.

## 8. Tests

- Unitaires : calcul du reste (budget, déjà commandé, sélection cochée), « J'ai commandé » ne prend que les cochés,
  choix du niveau, effacement des filtres.
- Navigateur (Playwright + axe) : parcours « Je le prends » → « Ma commande » → décocher → « J'ai commandé » →
  budget déduit ; double-tap → 4 niveaux ; aperçu ; fiche d'une boutique non lisible ; clair et sombre ; téléphone ;
  mouvement réduit (rien ne bouge, tout est lisible).
- Contrastes : tests existants des tokens, étendus aux nouvelles valeurs.

## 9. Hors périmètre, à décider plus tard

- Les vraies photos dans les maquettes (la vraie fiche en dev sert de test, § 7).
- « Garder pour plus tard » : retiré (aucune fonction derrière).
- Un sélecteur de palette ou de police pour les utilisatrices : non, un seul thème (clair / sombre).
- L'accueil détaillé : composé avec les mêmes pièces à l'étape 5, maquette à montrer avant.
