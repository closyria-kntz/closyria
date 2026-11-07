# Closyria V1 — Conception

> Statut : **à relire par l'utilisateur** · rédigée le 2026-11-01 à partir du brainstorming validé section par section.
> Remplace le brouillon `docs/plans/phase-1-capture-liens.md`.
> Chaque chantier aura ensuite son plan détaillé dans `docs/plans/`. La direction visuelle a sa propre spec.

## 1. Intention

Closyria aide les femmes à acheter des vêtements en ligne et à tenir leur dressing, **sans se prendre la tête** :
simple, efficace et joli. On l'utilise sans compte au départ, dans l'esprit de Vinted, avec un petit budget en tête.

**Critères de réussite de la V1**

- Coller un lien donne une fiche correcte (nom, prix, photos, tailles) en moins de 5 s sur la majorité des boutiques ciblées.
- Un achat suivi passe tout seul de « commandé » à « dans mon dressing », sans ressaisie.
- Aucune utilisatrice n'est jamais bloquée : quand l'automatique échoue, la saisie manuelle prend le relais.
- Le coût de l'IA reste marginal et maîtrisé : il ne doit jamais absorber le prix d'un abonnement.
- L'admin donne à la fondatrice une vision complète et professionnelle de l'activité.

**Marché** : France en V1, en français et en euros. Belgique, Suisse et Luxembourg francophones fonctionnent sans
garantie. Le code est prêt pour d'autres langues : **anglais et espagnol** en premier.

## 2. Principe central : un article unique qui avance

Un article a une vie, et l'utilisatrice ne le saisit qu'une fois :

```
Repéré ─► Commandé ─► Dans mon dressing ─► Retourné / Revendu
   │  (❤️ favori et wishlists à n'importe quelle étape)
```

- On peut **créer un article à n'importe quelle étape** : lien ajouté directement à une wishlist, photo ajoutée
  directement au dressing, e-mail de commande qui le crée à l'étape « Commandé ».
- Un article peut avancer ou reculer, par exemple en cas d'erreur.
- **Favori** est un drapeau. Les **wishlists** sont des listes nommées. Les deux sont indépendants de l'étape.

## 3. Périmètre de la V1

### Demandé par la fondatrice
Capture par lien · suivi des commandes · dressing virtuel · wishlists et favoris · annuaire des boutiques · admin complète.

### Ajouts validés (★)
| Domaine | Fonction |
|---|---|
| Avant l'achat | « Tu as déjà quelque chose de proche » (même catégorie et couleur) · calendrier des soldes |
| Argent | Rappel de date limite de retour · suivi des remboursements · avoirs et cartes cadeaux avec rappel d'expiration · budget (dépensé ce mois-ci, retours en cours) · historique par année (pièces achetées, retournées, dépenses ; chaque article garde ses dates dès le chantier 2) · factures rangées avec l'article |
| Dressing | Ajout par photo avec détourage · mes tailles par marque · notes perso sur la taille · composition et entretien repris de la fiche |
| Alertes | De retour dans ma taille · baisse de prix |
| Annuaire | Fiches pratiques (livraison, retours, guide des tailles) · filtres (made in France, seconde main, éco-responsable, retours gratuits, gamme de prix) |
| Quotidien | Application installable (PWA) avec « Partager → Closyria » · wishlist partageable par lien · recherche unique · notifications regroupées en résumé du jour · consultation sans réseau · accessible et en mode sombre · export de ses données |

### Après la V1
Tenues · coût par port · pièces jamais portées · rangement été/hiver · comparer deux articles · avis d'une amie ·
avis sur les boutiques · « Mettre en vente sur Vinted » · articles similaires par IA · extension navigateur · application
mobile native (Expo) · offre pour les boutiques.

**Nouveautés des boutiques (idée du 2026-11-05)** : relever automatiquement, à une date et une heure réglables par
boutique dans l'admin, les nouveaux articles mis en ligne, pour proposer « Nouveautés de mes boutiques préférées ».
- Faisable pour les boutiques Shopify (liste publique des articles avec leur date, déjà testé en septembre : 6 852
  articles) ; plus lourd pour Promod ou Zalando (plan du site, à limiter à des marques ou catégories) ; impossible pour
  les enseignes qui bloquent les robots.
- Précaution : recopier régulièrement un catalogue peut toucher au droit des bases de données de la boutique. Ne garder
  que l'utile (nom, prix, lien, une photo), renvoyer vers la boutique, et de préférence avec l'accord des boutiques
  (piste : partenariat avec les boutiques indépendantes, lié à l'offre pour les boutiques).
- Place : après le chantier 2 (il faut des boutiques suivies), avec les alertes (chantier 4) ou l'annuaire (chantier 5).

## 4. Décisions

| # | Sujet | Décision |
|---|---|---|
| D1 | Langage | TypeScript partout. Pas de Rust (décision redite le 2026-11-01) ; une brique Rust isolée seulement si une mesure le justifie. |
| D2 | Comptes | Sans compte au départ. Compte demandé au moment du besoin (suivi de commande, alerte, 2e appareil), sans perte de données. |
| D3 | Connexion | Sans mot de passe : code à 6 chiffres par e-mail, Google, Apple. Passkey en plus pour l'admin. |
| D4 | Suivi des commandes | Transfert de l'e-mail de confirmation vers une adresse personnelle + numéro de suivi collé. Pas d'accès OAuth à Gmail/Outlook. |
| D5 | Boutiques | Une table de référence gérée dans l'admin et utilisée par toute l'app. Boutiques inconnues créées « à valider ». |
| D6 | Modèle économique | Lancement gratuit avec limites, système de droits dès la V1, Premium plus tard. Formules entièrement gérées dans l'admin. |
| D7 | Autres revenus | Affiliation oui · boutiques « Sponsorisé » oui · pas de publicité classique · jamais de vente de données. |
| D8 | IA | En dernier recours, modèle le moins cher qui suffit (Claude Haiku), règles apprises par boutique, coût enregistré et plafonné, interrupteur d'urgence. |
| D9 | Détourage | Sur le serveur avec **BiRefNet lite** (mesuré : 6,8 s par photo sur 4 cœurs, 0 €). Exception assumée à « IA via API ». |
| D10 | Données côté client | Application web avec copie locale **en lecture** : consultation sans réseau, modifications à la reconnexion. Pas de moteur de synchronisation. |
| D11 | Photos | Copiées sur OVH Object Storage (Gravelines). Jamais de lien direct vers les images des boutiques. |
| D12 | Mesure d'audience | Événements enregistrés dans notre base, sans pisteur extérieur, conforme à l'exemption CNIL. |
| D13 | Confidentialité admin | L'admin ne voit pas le contenu des utilisatrices par défaut ; accès sur demande d'aide, journalisé. |
| D14 | IA et RGPD | Rester sur Bedrock en région européenne si le coût reste proche de l'API directe. |

## 5. Architecture

Le socle actuel est conservé (web, API, worker, PostgreSQL, script de déploiement). On ajoute des briques à rôle unique :

| Brique | Rôle |
|---|---|
| `apps/web` | Next.js. PWA installable, partage depuis le téléphone, copie locale en lecture, admin sous `/admin`. |
| `apps/api` | Hono. Seule porte d'accès aux données, pour le web et la future application mobile. Routes admin sous `/api/admin`. |
| `apps/worker` | pg-boss. Tout ce qui est lent ou planifié : captures, e-mails, détourage, alertes, résumés, nettoyages. |
| `packages/db` | Tables et migrations Drizzle. |
| `packages/shared` | Schémas Zod partagés (article, boutique, commande…). |
| `packages/extract` | Code pur : `(url, contenu) → fiche validée`. Shopify → données structurées schema.org → balises Open Graph. |
| `packages/auth` | Better Auth : anonyme, code e-mail, Google, Apple, passkey admin. |
| `packages/entitlements` | Droits et limites par formule. Toute fonction qui coûte passe par ici. |
| `packages/ai` | Seul point d'accès à l'IA : choix du modèle, cache, traitement par lots, coût enregistré, plafonds, interrupteur. |
| `packages/vision` | Détourage BiRefNet lite via ONNX Runtime pour Node, ré-encodage des images, couleur dominante. |
| `packages/i18n` | Textes en fichiers de traduction (fr, puis en et es). |

`extract`, `shared` et `i18n` n'accèdent ni au réseau ni à la base : ils seront réutilisés par l'application mobile et
l'extension.

**Services extérieurs**

| Besoin | Service |
|---|---|
| Photos | OVH Object Storage, Gravelines |
| E-mails envoyés | Brevo (déjà configuré sur le domaine) |
| E-mails de commande reçus | Sous-domaine dédié (ex. `xxxx@commandes.closyria.com`). Le domaine principal reste chez Google Workspace. Réception via Brevo si l'offre l'inclut, sinon une autre solution sera proposée. |
| IA | Claude Haiku via Bedrock (région européenne) |
| Notifications | E-mail + notifications web push de l'application installée |
| Paiements | Stripe (formules synchronisées depuis l'admin) |
| Suivi des colis | API des transporteurs (Colissimo, Mondial Relay, Chronopost…) ou agrégateur : coûts à chiffrer au chantier 3 |

## 6. Données

Montants **en centimes**, dates en UTC et affichées à l'heure de Paris. Tout ce qui appartient à une utilisatrice est
réellement supprimé avec son compte. Les fiches produits partagées restent : elles ne contiennent rien de personnel.

| Famille | Tables principales |
|---|---|
| Utilisatrices | comptes et sessions (Better Auth) · profil (langue, préférences de notifications, adresse de transfert) · tailles par marque (saisie ou déduite) · rôle admin |
| Catalogue partagé | boutiques (adresses web, expéditeurs d'e-mails, règles de lecture apprises, infos pratiques, filtres, affiliation, sponsorisé, textes traduisibles, statut à valider / brouillon / publiée) · produits (une fiche par article de boutique, partagée) · tailles du produit (disponibilité, prix) · historique (prix et stock à chaque visite) · référentiels (catégories, couleurs, guides de tailles) |
| Article de l'utilisatrice | articles (étape, favori, produit d'origine ou rien, taille choisie, note de taille, prix payé, photos, catégorie, couleur) · wishlists et leurs articles (lien de partage révocable) · médias (photo d'origine, version détourée) |
| Achats et argent | commandes et lignes · colis et étapes de livraison · retours et remboursements (date limite selon la boutique, remboursement attendu, reçu) · avoirs et cartes cadeaux (code chiffré) · e-mails reçus (chiffrés, effacés après 30 jours) |
| Alertes | alertes (stock dans une taille, prix sous un seuil) · notifications (immédiates ou résumé du jour) · calendrier des soldes |
| Pilotage | captures (méthode, durée, erreur) · formules, droits et compteurs · appels IA (usage, modèle, coût) · clics et commissions d'affiliation · événements d'usage · journal des actions admin |

## 7. Parcours clés

### 7.1 Ajouter par lien (coller ou « Partager → Closyria »)
1. La fiche s'ouvre tout de suite avec un squelette animé.
2. Le worker reconnaît la boutique, visite la page en sécurité et extrait la fiche.
3. En 2 à 5 s la fiche se remplit. Choix en un geste : ❤️ favori, wishlist, « Je l'ai commandé ».
4. « Tu as déjà quelque chose de proche » si une pièce semblable existe dans son dressing.
5. En cas d'échec, la fiche reste créée avec le lien et la saisie manuelle est proposée. L'échec remonte dans l'admin.
6. Une boutique inconnue fonctionne pareil et apparaît « à valider » dans l'admin.

### 7.2 Ajouter par photo
1. La photo apparaît tout de suite dans le dressing.
2. Le détourage (≈ 7 s) remplace l'image ; retour à l'originale toujours possible.
3. Couleur dominante calculée localement ; catégorie choisie en un geste parmi des suggestions.

### 7.3 Suivre une commande
1. Transfert de l'e-mail de confirmation vers son adresse Closyria, ou numéro de suivi collé.
2. Seuls les e-mails transférés depuis **son** adresse vérifiée sont acceptés.
3. Boutique reconnue par l'expéditeur. Lecture : données structurées → règles apprises de la boutique → IA (qui
   produit une règle pour les fois suivantes).
4. Articles reliés à ceux existants (ex. le favori) ou créés, à l'étape « Commandé ».
5. Colis suivi. À la livraison, entrée dans le dressing avec le badge « Retour possible jusqu'au … » (délai de la boutique).
6. Rappel 3 jours avant la date limite. En cas de retour : remboursement attendu avant une date, alerte s'il n'arrive pas.
7. Les articles gardés alimentent « Mes tailles ».

### 7.4 Alertes
- Le worker revisite les produits suivis à un rythme qui dépend de l'enjeu, dans la limite de chaque boutique.
- « De retour dans ta taille » est immédiate. Les baisses de prix vont dans le résumé du jour, sauf préférence contraire.

### 7.5 Anonyme → compte
Au moment du besoin : « Garde tes articles : continue avec Google, Apple ou ton e-mail ». Rien n'est perdu.

**Mon compte** (ajouté le 2026-11-07, oubli de la conception, voir `docs/specs/2026-11-07-mon-compte.md`) : le menu
montre toujours qui est connectée (e-mail, ou « Sans compte ») ; la page « Mon compte » des réglages donne l'e-mail,
la date de création et « Se déconnecter ». Pas de déconnexion sans compte : ses articles seraient perdus.

### 7.6 Sans réseau
Consultation du dressing, des wishlists et des photos. Bandeau « Hors ligne : modifications à la reconnexion ».

## 8. Admin

Zone `/admin` du même site, réservée au rôle admin, droits vérifiés côté serveur à chaque action, passkey, toutes les
actions journalisées. Pensée d'abord pour l'ordinateur, utilisable sur téléphone. Chaque chantier livre sa partie.

| Écran | Contenu | Chantier |
|---|---|---|
| Tableau de bord | Activité, captures et réussite, coût IA face au budget, erreurs | 0 → 1 |
| Boutiques | Liste filtrable, « à valider » triées par popularité, ajout depuis une adresse avec pré-remplissage, test de lien en direct, santé, fusion de doublons, affiliation, sponsorisé avec dates | 1 |
| Captures en échec | Derniers échecs avec leur raison | 1 |
| Référentiels | Catégories, couleurs, guides de tailles | 2 |
| Utilisatrices | Recherche, formule, consommation, ajustements, suppression sur demande | 2 |
| E-mails de commande | Boutiques non lues, règles apprises, relecture | 3 |
| IA et coûts | Par usage, boutique et mois ; seuil d'alerte ; interrupteur d'urgence | 3 |
| Calendrier des soldes | Dates et messages | 4 |
| Formules | Création (prix mensuel et annuel, essai, limites par droit, accès aux fonctions), visibles ou cachées, codes promo, formule offerte, versions sans léser les abonnées, synchronisation Stripe | 6 (le système de droits existe dès le 0) |
| Statistiques | Revenus (MRR, churn, conversion, valeur vie client), affiliation et sponsorisé, activité (jour, semaine, mois), parcours d'activation, cohortes, usage des fonctions, tendances catalogue (boutiques, marques, catégories, couleurs, taux de retour), exploitation (files du worker, serveur, sauvegardes, délivrabilité) | progressif, complet au 6 |
| Réglages | Limites gratuites, activation progressive des fonctions | 0 → enrichi |

Confort : grands tableaux triables et filtrables, recherche instantanée, choix de période et comparaison, graphiques,
export CSV, palette de commandes ⌘K, mode sombre. Les statistiques sont **agrégées** (règle D13).

## 9. Sécurité

**Capture de liens**
- `http`/`https` sur ports standards uniquement, sans cookies, identifiant de robot explicite.
- Refus de toute adresse interne ou privée (IPv4 et IPv6), vérifiée après résolution DNS et à chaque redirection.
- 5 redirections, 5 Mo, 15 s au maximum ; rythme limité par boutique.
- Deuxième barrière : systemd interdit au worker les réseaux privés.

**Contenus reçus**
- Photos ré-encodées et débarrassées de leurs métadonnées, dont la position GPS.
- Textes extérieurs jamais exécutés, toujours nettoyés.
- L'IA ne fait que lire : sortie structurée validée par Zod, aucune action possible (protection contre les e-mails piégés).

**Comptes et accès**
- Cookies de session protégés, protection CSRF.
- Code e-mail : 10 minutes de validité, 5 essais, envois limités.
- Chaque requête filtrée par utilisatrice ; tests automatiques d'isolation sur toutes les routes.
- Liens de wishlist impossibles à deviner et révocables ; adresse de transfert régénérable.

**Serveur et code**
- Limitation des requêtes par IP et par compte ; validation Zod de toutes les entrées.
- En-têtes de sécurité dont CSP et **HSTS (à activer au chantier 0)**.
- Chiffrement applicatif des e-mails reçus et des codes d'avoirs ; sauvegardes déjà chiffrées.
- Aucune donnée personnelle dans les journaux.
- Audit des dépendances dans la CI et délai avant d'adopter une nouvelle version d'un paquet.
- Webhooks Stripe vérifiés par signature.

## 10. RGPD et obligations légales

- Hébergement en France (serveur, OVH, Brevo). Prestataires : OVH, Brevo, AWS (Bedrock, Europe), Stripe, Google, Apple.
- Si l'API Anthropic directe remplace Bedrock, le transfert hors UE devra être déclaré (voir D14).
- Minimisation : e-mail d'origine effacé après 30 jours, adresse postale jamais conservée, comptes anonymes inactifs
  purgés au bout de 6 mois (annoncé).
- Droits en libre-service : export complet (données et photos), suppression réelle (sauvegardes expirées sous 30 jours),
  correction.
- Consentement seulement pour les cookies d'affiliation et les e-mails promotionnels.
- Affiliation et « Sponsorisé » toujours signalés.
- Pages publiques : mentions légales, CGU (inscription à partir de 15 ans), confidentialité, cookies.
- Dans `docs/` : registre des traitements, procédure de fuite de données (déclaration CNIL sous 72 h).

## 11. Tests

Tests écrits **avant** le code (TDD).

| Niveau | Outil | Portée |
|---|---|---|
| Unitaires | Vitest | `extract`, lecture d'e-mails, droits, dates et montants, garde anti-liens piégés, complétude des traductions |
| Intégration | Vitest + PostgreSQL de test (aussi en CI) | API, worker, migrations depuis zéro, webhooks Stripe et e-mails, **isolation sur chaque route** |
| Bout en bout | Playwright, écran de téléphone et d'ordinateur | ~10 parcours : lien → favori, photo → dressing, anonyme → compte, e-mail → commande → livrée → dressing, wishlist partagée, hors ligne, ajout de boutique en admin |
| Accessibilité | axe dans Playwright + revue d'accessibilité | Chaque écran |
| Surveillance réelle | Tâche quotidienne sur le serveur, hors CI | Une vraie capture par boutique publiée → santé des boutiques |
| Performance | Lighthouse, mesures API | Page affichée en moins de 2,5 s sur mobile |

- Aucun accès Internet dans les tests : pages de boutiques enregistrées servies par une fausse boutique locale, réponses
  d'IA enregistrées, détourage testé sur une petite image.
- Couverture visée : 90 % du code pur, 80 % de l'API, 100 % des routes pour l'isolation.
- `main` n'accepte que du code dont la CI est au vert (lint, types, unitaires, intégration, bout en bout). Vérification
  rapide automatique après chaque déploiement en dev.

## 12. Ordre de livraison

Chaque chantier est livré en dev, testé par la fondatrice, puis mis en prod. Chacun a son plan détaillé.

| # | Chantier | Contenu |
|---|---|---|
| 0 | Socle V1 ✅ (en prod le 2026-11-05) | Direction visuelle (spec dédiée, maquettes), comptes, droits, traductions, photos OVH, mesure d'audience, coque de l'admin, HSTS |
| 1 | Capture et boutiques (conception : `2026-11-05-chantier-1-capture-boutiques.md`) | `extract`, worker sécurisé, fiche produit, admin boutiques et santé |
| 2 | Mon dressing (2a « Garder » déployé en dev le 2026-11-06, en prod avec le chantier 1 après les sauvegardes ; 2b reste à faire) | Favoris, wishlists, dressing, photo et détourage, « déjà quelque chose de proche », mes tailles, recherche, hors ligne, PWA et partage |
| 3 | Commandes et argent | Transfert d'e-mail, colis, retours, remboursements, avoirs, budget, admin IA et coûts |
| 4 | Alertes | Stock et prix, notifications, résumé du jour, calendrier des soldes |
| 5 | Annuaire | Annuaire public, filtres, affiliation, sponsorisé |
| 6 | Lancement | Formules et Stripe, statistiques complètes, pages légales, export et suppression, revue de sécurité |

## 13. Prérequis et points ouverts

**À fournir par la fondatrice (au fil des chantiers)**

| Quand | Prérequis |
|---|---|
| Chantier 0 | Bucket OVH pour les photos (prod et dev) et accès restreints · projet Google Cloud pour « Continuer avec Google » · compte Apple Developer (99 $/an) pour « Continuer avec Apple » |
| Chantier 1 | Liste de boutiques de départ (à défaut : 6 boutiques Shopify du test de septembre + Zara, Mango, H&M, Sézane, Kiabi, Promod, Etam, Vinted, Zalando, Shein, La Redoute, Vestiaire Collective) |
| Chantier 3 | Sous-domaine `commandes.closyria.com` (enregistrements DNS) · accès Bedrock en région européenne |
| Chantier 5 | Inscriptions aux réseaux d'affiliation |
| Chantier 6 | Compte Stripe · textes légaux (relecture juridique recommandée) |

**À vérifier pendant les chantiers**

- La réception d'e-mails est-elle incluse dans l'offre Brevo ? (chantier 3)
- Coût des API transporteurs ou d'un agrégateur. (chantier 3)
- Disponibilité de Claude Haiku sur Bedrock en région européenne et prix. (chantier 3)
- Limites chiffrées de la formule gratuite, à fixer avec les premiers usages. (chantiers 2 à 6)
- Détourage d'un vêtement seul sur une photo portée (modèles de découpe par vêtement) : à tester. (après la V1)
