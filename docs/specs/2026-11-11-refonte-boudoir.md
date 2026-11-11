# Refonte « Boudoir » — cahier des charges

Remplace la direction « Cocon lumineux » (`docs/specs/2026-11-08-refonte-design.md`). Maquette de référence (privée) :
https://claude.ai/artifact/WgzJUyaHkMMqSp5G8Gb7xY — les valeurs (couleurs, polices, rayons, tailles) y sont la
référence et se reprennent telles quelles ; chaque écran est comparé à la maquette (mesures et captures) avant d'être
montré.

## 1. Pourquoi

Retour de la fondatrice (2026-11-11) sur le design actuel :
- on ne sait pas par où commencer ;
- on ne voit pas les actions (cachées dans « … ») ;
- on ne sait pas où aller ;
- les mots et étapes sont flous (Repéré, Commandé, Garder, niveaux…) ;
- pas assez « mode », trop chargé d'effets, les vêtements ne ressortent pas.

Ce qu'elle veut : une refonte complète, pensée pour l'existant **et** les futurs chantiers (commandes et argent,
alertes, annuaire et catalogue, lancement). Pas de minimalisme ni de site « vide » ; pas de look « fait par une IA ».
Elle aime : les vêtements en vedette, des « unes » façon magazine, de la chaleur.

Réussi quand une nouvelle utilisatrice sait, sur chaque écran, ce qu'elle peut faire sans ouvrir de menu caché, et
retrouve tous ses articles (envies, commandés, dressing) dans une seule vue.

## 2. Décisions validées (2026-11-11)

| # | Sujet | Décision |
|---|---|---|
| R1 | Périmètre | Refonte de toute l'app (structure, guidage, identité, tous les écrans) ; le catalogue « Découvrir » est **prévu** (place dans le menu, écrans) mais construit dans un chantier à part, après. |
| R2 | Menu | **Accueil · Découvrir · + · Mes articles · Moi** (en bas sur téléphone, en haut sur ordinateur ; un seul menu à la fois). |
| R3 | Accueil | Page vivante : « unes » des nouvelles (baisse de prix, taille revenue, avis d'une amie, commande groupée, plus tard colis), zone « Ajouter un article », astuce, boutiques à découvrir, envies du moment. |
| R4 | Découvrir (à construire plus tard) | Catalogue fait des articles collés par les utilisatrices (sans dire qui) + catalogues complets des boutiques choisies en admin ; recherche, filtres, « boutique de la semaine ». |
| R5 | Mes articles | Une seule vue de tous ses articles, ouverte sur « Tout » ; chaque carte porte son étape ; pastilles Envies · Commandés · Reçus · Dressing · À vendre ; en haut, onglets Articles · Listes · Commandes groupées ; sur ordinateur, bouton « Par étape » (colonnes). |
| R6 | Moi | Compte, budget, commandes et colis (chantier 3), réglages ; aperçus chiffrés (dressing, à vendre, commandes, budget). |
| R7 | Bouton + | Ouvre « Ajouter un article » : coller un lien, prendre une photo, partager depuis une boutique, (plus tard) transférer un e-mail de commande. |
| R8 | Guidage | Actions en **boutons écrits** sur chaque écran (plus de « … » pour les actions principales) ; écrans vides qui expliquent quoi faire ; découverte en 3 écrans à la première ouverture (qu'on peut passer) ; bulles d'astuce qu'on ferme une fois lues ; l'avancée d'un article en ligne : Envie → Commandé → Reçu → Dans mon dressing. |
| R9 | Identité | **Boudoir** (§ 4). |

## 3. Structure

### 3.1 Où va chaque chose (existant et futur)

| Aujourd'hui | Demain |
|---|---|
| `/` (coller un lien, derniers liens) | **Accueil** (`/`) : « unes », ajout, nouvelles, astuces |
| `/envies`, `/dressing`, `/a-vendre` | **Mes articles** (`/articles`, filtres par étape ; les anciennes adresses redirigent avec le bon filtre) |
| `/listes`, `/listes/[id]`, commande groupée | **Mes articles › Listes** et **› Commandes groupées** (adresses gardées) |
| `/envies/commande` (préparer une commande) | **Mes articles**, filtre Envies, action « Préparer une commande » |
| `/produits/[id]` (fiche) | Fiche refaite : avancée en ligne, actions écrites, avis des amies, mon article |
| `/reglages`, budget, compte | **Moi** (`/moi`) et ses sous-pages ; `/reglages/*` gardé |
| `/aide` | Moi › Aide, et astuces dans les écrans |
| `/l/[token]` (lien des amies) | Même adresse, nouvelle identité ; actions écrites (Je lui offre, Je participe, Je le prends aussi, Donner mon avis) |
| (futur) commandes, colis, retours, avoirs | Moi › Commandes ; nouvelles sur l'Accueil |
| (futur) alertes | Nouvelles sur l'Accueil ; réglages dans Moi |
| (futur) catalogue et annuaire | **Découvrir** (`/decouvrir`) |
| Admin | Hors refonte (l'admin garde sa coque ; seuls les jetons communs changent) |

### 3.2 Mots

Les étapes visibles deviennent : **Envie · Commandé · Reçu · Dans mon dressing · À vendre** (« Repéré » disparaît de
l'interface ; le code garde ses identifiants). Chaque bouton dit ce qu'il fait (« Je l'ai commandé », « Voir chez
{boutique} », « Demander un avis », « Ajouter à une liste », « M'alerter si le prix baisse », « Partager »).

## 4. Identité Boudoir

- **Couleurs (clair)** : fond `#FBF7F4`, encre `#2B1418`, texte secondaire `#86686D`, filets `#ECDCD9`, cartes
  `#FFFFFF`, doux `#F6E6E3`, rose poudré `#F3D6DA`, bordeaux `#5B1A2A` (bandeau, boutons principaux), bordeaux accent
  `#8C2A3C`, ocre `#D9A441` (bouton « Ajouter » dans le bandeau, étiquettes), astuce `#FFF1D6` / `#5A3D00`.
- **Sombre** : à dériver (fond bordeaux très sombre, cartes un cran plus claires, rose poudré pour l'accent) ;
  contrastes AA vérifiés ; montré à la fondatrice avant d'être construit.
- **Polices** : titres et noms d'articles **Gloock** ; texte **Figtree**.
- **Formes** : cartes très arrondies (20 px), pastilles et boutons en pilule, photos 3:4.
- **Signature** : étiquettes de prix en forme d'étiquette de vêtement (petit trou), « unes » rose poudré, bandeau
  bordeaux, bouton + central bordeaux qui dépasse du menu.
- **Mouvement** : sobre ; ouverture des panneaux et passage d'un onglet à l'autre ; respecte la réduction des
  animations.

## 5. Règles

- Rien de ce qui fonctionne aujourd'hui ne disparaît : chaque fonction existante a sa place (§ 3.1) ; les adresses
  actuelles redirigent.
- Tous les tests de parcours existants sont adaptés et repassent ; accessibilité AA (axe) en clair et en sombre ;
  zones tactiles ≥ 44 px.
- Jetons de design uniquement (`packages/design-tokens`), vérifiés par `scripts/check-design-tokens.ts`.
- Mesurer contre la maquette avant de montrer chaque écran.
- Livraison par étapes en dev, chacune montrée à la fondatrice avant la suivante (ordre au plan).

## 6. Technique (pour l'équipe)

- Nouveaux jetons dans `packages/design-tokens` (primitives et sémantiques) ; les anciens retirés une fois tout migré.
- Polices Gloock et Figtree auto-hébergées (comme Fraunces et Jost aujourd'hui).
- Coque : nouveau menu (`app-shell`), bouton + et sa feuille « Ajouter un article ».
- `/articles` réutilise la vue des articles existante (filtres par étape, sélection, actions) ; « Par étape » = vue en
  colonnes sur grand écran.
- Accueil : agrège ce qui existe déjà (baisses de prix, tailles revenues, avis nouveaux, commandes groupées en cours) ;
  pas de nouvelle donnée.
- Découverte et astuces : état « vu » retenu par compte (préférences existantes) pour ne pas les remontrer.
- Découvrir (validé le 2026-11-11) : en attendant le catalogue, l'onglet montre les boutiques déjà connues (actives en admin) et une « boutique de la semaine » choisie en admin ; le catalogue d'articles s'y ajoutera ensuite.

## 7. Hors de ce chantier

- Le catalogue « Découvrir » lui-même (collecte des catalogues de boutiques, recherche, annuaire).
- Les fonctions des chantiers 3 à 6 (commandes et colis, alertes, annuaire, paiement) : seulement leur place.
- L'admin (hors jetons communs).
