# Closyria — Direction visuelle

> Statut : **à relire par la fondatrice** · rédigée le 2026-11-01 à partir du brainstorming validé section par section.
> Complète la conception V1 (`docs/specs/2026-11-01-v1-conception.md`). Maquettes de référence : pages « Ambiances
> Closyria », « Dragée Couture » et « Palettes Closyria » (claude.ai, privées).

> **Mise à jour du 2026-11-07** : la palette (§ 3.1), les caractères (§ 4) et les coins (§ 5) ont changé, voir
> `docs/specs/2026-11-07-envies-chaleureuses.md` (§ 3.9 et 5.4). Palette C « chocolat et rose poudré » : clair, fond
> `#F2EDE7`, cartes `#FFFFFF`, encre `#2B1D17`, encre douce `#6E5A50`, trait `#E5D7CC`, accent `#5A3A2E`, rose poudré
> `#EBC7C3`, jaune beurre `#F3E3A6`, sauge `#D5DCC8`, fond des photos latte `#EADBC8` (plus de camel) ; sombre, fond
> `#1E1612`, cartes `#2A201B`, encre `#F2EDE7`, encre douce `#C9B8AE`, accent `#EBC7C3`, fond creux et fond des photos
> `#241A15`, trait et conseils `#3D2F28`. Titres en **Fraunces**, texte en **DM Sans** (à la place
> de Cormorant Garamond et Jost). Cartes à 26 px, boutons en pilule. Les tableaux ci-dessous sont l'état d'origine.

## 1. Intention

Une appli **simple, efficace et jolie** pour des femmes qui ne doivent jamais se prendre la tête. Le style est
**chic et accueillant** : l'élégance d'une maison de couture, la douceur d'une boutique où l'on aime revenir.
Les photos d'articles sont les vedettes ; l'interface les met en valeur sans les concurrencer.

## 2. Principes

1. **Tout passe par les tokens.** Aucune couleur, taille, durée ou ombre écrite en dur ; la vérification
   automatique (`scripts/check-design-tokens.ts`) le garantit.
2. **Téléphone d'abord**, puis ordinateur.
3. **Clair et sombre** soignés à égalité. Le sombre suit le réglage du téléphone ; l'utilisatrice peut le forcer.
4. **Accessible** : contrastes AA au minimum, cibles tactiles de 44 px au moins, focus toujours visible.
5. **Une seule identité de référence** (Équilibré) ; les autres apparences sont des variantes de tokens.

## 3. Apparences

| Apparence | Statut | Rôle |
|---|---|---|
| **Équilibré** | Référence, seule apparence pendant le développement | Site public, appli, e-mails, admin, captures des stores |
| Couture | Conservée, livrée au chantier 4 avec le sélecteur d'apparence | Au choix de l'utilisatrice |
| Dragée, Chic | Possibles plus tard | Au choix ; piste d'avantage Premium (à décider avec les formules) |

### 3.1 Palette Équilibré

| Token sémantique | Clair | Sombre |
|---|---|---|
| `surface` (fond) | `#F7F0ED` | `#1C1219` |
| `surface-raised` (cartes) | `#FFFDFB` | `#261A23` |
| `ink` (texte) | `#2E1A2A` | `#F6EBEE` |
| `ink-muted` | `#6F5A67` | `#B9A3B0` |
| `line` (contours) | `#E8DCD8` | `#3A2A35` |
| `accent` (actions) | `#7A2E5F` | `#E7A6CB` |
| `accent-ink` (texte sur action) | `#FFF6F0` | `#1C1219` |
| `success` (confirmations) | `#1F4A3F` sur `#DCEBE2` | `#A9DCBF` sur `#1D3A31` |
| `premium` (champagne) | `#6A4F12` sur `#F1E4C6` | `#E8CF8F` sur `#3A3220` |
| `hint` (conseils) | `#F6EAD8` | `#322A22` |
| `media-backdrop` (fond des photos) | `#EFE2DF` | `#2F2129` |

`danger` et `focus-ring` sont dérivés au moment de l'implémentation, avec contrôle AA dans les deux modes.

### 3.2 Palette Couture (pour le chantier 4)

Clair : fond `#EEF0EA`, cartes `#FBFBF7`, encre et action `#15302A`, texte sur action `#F3E7C9`, champagne `#F3E7C9`.
Sombre : fond `#0F201C`, cartes `#162B26`, encre `#EFE9DA`, action or `#D9BD7A`.

## 4. Typographie

| Rôle | Police | Usage |
|---|---|---|
| Titres | **Cormorant Garamond** (500–600) | Titres d'écran, nom d'un article, grands chiffres de l'admin |
| Texte | **Jost** (400–600) | Tout le reste : texte, boutons, étiquettes, formulaires |

- Polices servies par le site lui-même (pas d'appel à Google à chaque visite : performance et RGPD).
- Échelle typographique en tokens ; le texte courant ne descend pas sous 16 px sur téléphone.
- Pas de texte tout en majuscules pour les étiquettes.

## 5. Formes

| Élément | Choix |
|---|---|
| Boutons | **Arrondis** (rayon moyen, ≈ 10 px) |
| Cartes | **Coins doux** (≈ 12 px), contour léger `line`, sans ombre |
| Pastilles (statuts) | Entièrement arrondies |
| Champs de formulaire | Même rayon que les boutons |

## 6. Photos et images

### 6.1 Dans les cartes
- La photo est **toujours visible en entier**, jamais recadrée : elle tient dans un cadre au format **portrait 3:4**,
  posée sur le fond `media-backdrop`.
- Les photos détourées se posent directement sur ce fond, ce qui unifie le dressing.
- **Au survol** (souris uniquement) : **aucune surbrillance ni voile**. La photo grossit très légèrement et
  lentement à l'intérieur de son cadre (≈ 3 %, ≈ 400 ms, courbe douce), puis revient. Désactivé sur écran tactile et
  quand le téléphone demande moins d'animations.

### 6.2 Agrandissement
- **Toucher ou cliquer une photo l'ouvre en grand** (visionneuse plein écran) : photo entière, zoom au pincement ou à
  la molette, glisser pour passer à la photo suivante de l'article, fermer par la croix, `Échap` ou un glissement vers
  le bas. Navigation au clavier et lecteurs d'écran pris en charge.

### 6.3 Poids et stockage
- À l'envoi, chaque photo est déjà nettoyée et réduite (WebP, 2 048 px maximum, voir chantier 0).
- On génère en plus **trois tailles**, servies selon l'écran :
  - **vignette** (≈ 400 px) pour les cartes et listes ;
  - **moyenne** (≈ 1 024 px) pour la fiche article ;
  - **grande** (2 048 px) pour la visionneuse uniquement.
- Les photos récupérées sur les boutiques suivent le même traitement (copie, réduction, trois tailles).
- La détection de la couleur dominante et le détourage travaillent sur la taille moyenne.

### 6.4 Écrans vides et illustrations
- Chaque écran vide (dressing vide, aucune commande…) a une petite illustration et une phrase qui invite à agir.
- Style d'illustration à définir avec les thèmes de saison (chantier 4).

## 7. Icônes

Trait fin et arrondi, famille **Lucide**, taille et épaisseur en tokens. Une icône seule n'est utilisée que pour une
action évidente (fermer, favori) ; sinon elle est accompagnée d'un texte.

## 8. Mouvements

- **Sobres et utiles** : une animation montre ce qui a changé (le cœur qui se remplit, la fiche qui se complète
  pendant la capture, l'article qui glisse vers « Dans mon dressing »).
- **Un seul moment fort** : l'arrivée d'une fiche capturée, révélée en douceur.
- Durées en tokens : rapide ≈ 150 ms, base ≈ 250 ms, lente ≈ 400 ms (survol des photos).
- Toutes les durées tombent à 0 quand le téléphone demande moins d'animations (déjà en place dans les tokens).

## 9. Ton des textes

- **Tutoiement**, chaleureux et direct, comme une amie qui s'y connaît : « Tu as déjà 2 chemises proches »,
  « Il te reste 3 jours pour la renvoyer ».
- Phrases courtes, mots du quotidien (« colis », pas « expédition »).
- Un bouton dit exactement ce qu'il fait (« Ajouter aux envies »), et le message de confirmation reprend le même mot.
- Les erreurs disent quoi faire : « Ce lien n'a pas marché, ajoute la photo toi-même ».
- Tous les textes vivent dans `packages/i18n` ; la relecture des textes passe par le plugin de rédaction d'interface.

## 10. Thèmes de saison et de fêtes

### 10.1 Ce qu'un thème peut changer
- Des **couleurs** (redéfinition de certains tokens sémantiques).
- Des **décorations animées** (neige, feuilles, chauves-souris, confettis…).
- Une **image ou illustration d'en-tête** sur l'accueil.
- Des **textes d'accroche** traduisibles.
- Plus tard, éventuellement, une icône d'appli de saison.

### 10.2 Règles
1. **Lisibilité garantie** : l'admin vérifie les contrastes du thème avant publication et refuse un thème illisible.
2. **Légèreté** : décorations ≤ 150 Ko environ, chargées après la page, jamais bloquantes.
3. **Désactivable** : interrupteur « Décorations de saison » dans les réglages ; le réglage « réduire les animations »
   du téléphone est toujours respecté.
4. **Jamais sur les écrans sérieux** : argent (remboursements, avoirs), erreurs, compte et sécurité.
5. **Programmé par dates** dans l'admin, avec aperçu ; activation et fin automatiques.
6. Les valeurs d'un thème venant de l'admin sont **validées** avant rendu (aucun caractère qui permettrait d'injecter
   du CSS).

### 10.3 Calendrier de départ
Halloween · Noël et fêtes de fin d'année · soldes d'hiver · Saint-Valentin · printemps · soldes d'été.
La fondatrice l'enrichit dans l'admin.

### 10.4 Livraison
Le moteur des thèmes, leur admin et le sélecteur d'apparence arrivent au **chantier 4**, avec le calendrier des soldes.
Le format des décorations (`DecorationSet`) est déjà défini dans `packages/design-tokens`.

## 11. Admin

Même identité (Équilibré), en plus **sobre et dense** : tableaux, graphiques, palette ⌘K. Pas de décorations de
saison dans l'admin.

## 12. Suite immédiate (tâche 4 du chantier 0)

- Remplacer les valeurs provisoires des tokens par la palette Équilibré (§3.1), les formes (§5), la typographie (§4)
  et les durées (§8), avec contrôle des contrastes AA en clair et en sombre.
- Héberger Cormorant Garamond et Jost dans le site.
- Les photos (§6) et les thèmes (§10) sont mis en œuvre dans les chantiers qui les utilisent (2 et 4).

## 13. Maquettes validées

| Écran | Fichier | Validée le |
|---|---|---|
| Accueil de l'appli (téléphone et ordinateur, clair et sombre) | `docs/maquettes/accueil.html` | 2026-11-01 |

Ordre de l'accueil : salutation et résumé · « Ajoute un article » (coller un lien, rappel du partage) · « En ce moment »
(colis, retours, remboursements) · « Tes favoris » (bonnes nouvelles d'abord) · conseil du moment. Navigation en bas
sur téléphone, en haut sur ordinateur. Sert de référence au chantier 1.
