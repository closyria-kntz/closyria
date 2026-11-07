# Passe design — cadre fixe, fiche « D », accueil (2026-11-06)

> **Statut (2026-11-07) : abandonnée.** Codée et testée en dev, l'ensemble ne plaît pas à la fondatrice. Dev est
> revenu à la présentation de la prod ; le code reste sur la branche locale `archive/passe-design` (d455e52) pour en
> reprendre des morceaux. Nouvelles maquettes à faire à partir de ses retours.

Décisions de la fondatrice sur les maquettes `docs/design/2026-11-06-passe-design-maquettes.html`
(https://claude.ai/artifact/AcnMvJcTE8oyTBVKtPjsD6) : **fiche D**, **accueil option 3**, **pied de page retiré**.
Les couleurs et les polices ne changent pas (tokens actuels) ; on change la mise en page.

## 1. Cadre fixe : seul le contenu défile

- L'écran de l'appli est un cadre de la hauteur de la fenêtre (`100dvh`) : menu latéral (ordinateur), en-tête,
  onglets (téléphone) et barre d'onglets (tablette) ne bougent jamais. Seule la zone de contenu (`#app-content`) a
  une barre de défilement.
- Changer de page remet la zone de contenu en haut (comme le faisait la fenêtre).
- Les fenêtres (visionneuse, « Ajouter une photo », confirmation) restent par-dessus tout, comme aujourd'hui.
- Contrepartie connue et acceptée : sur iPhone, la barre d'adresse de Safari ne se replie plus au défilement.
- Hors du cadre de l'appli (connexion, liste partagée `/l/…`, admin) : rien ne change dans cette passe.

## 2. Menu

- **Ordinateur (≥ 1024 px)** : menu latéral avec libellés (comme aujourd'hui) et **compteurs** à droite de
  Envies, Commandé, Dressing, À vendre (articles actifs du profil courant). En bas du menu : lien **Aide**.
  Confidentialité et Conditions n'existent pas encore comme pages : elles y seront ajoutées quand elles existeront
  (avant l'ouverture au public).
- **Téléphone** : 5 onglets inchangés (Accueil, Envies, Commandé, Dressing, Plus) ; Aide est dans « Plus ».
- **Pas de pied de page.**
- **« Coller un lien » dans l'en-tête sur ordinateur** (champ compact, sur toutes les pages sauf l'accueil, qui a
  le sien). Sur téléphone et tablette : le bouton « + Ajouter » actuel reste.

## 3. Fiche article (« D »)

**Ordinateur large (≥ 1280 px)** : trois zones.
- Centre, défile : l'essentiel (boutique, marque, nom, prix, « Voir chez … »), **un résumé de mon article** sous le
  prix quand l'article est gardé (étape actuelle en pastille + ma taille si renseignée), les photos en mosaïque (la
  première en grand), puis **La boutique** (tailles, caractéristiques, détails de la boutique, description, date de
  mise à jour).
- Droite, panneau fixe de 300 px qui défile seul : **Mon article** (favori, étapes en frise, taille et montants,
  notes, listes, étiquettes) puis **Autres actions** en bas du panneau (changer de profil, supprimer).
- Article pas encore gardé : le panneau de droite montre les boutons « Garder cet article » (♡, étapes).

**En dessous de 1280 px (tablette, petit ordinateur) et téléphone** : une seule colonne, dans l'ordre
essentiel (+ résumé) → photos → La boutique → Mon article → Autres actions.

**Étapes en frise** : Repéré, Commandé, Reçu, À vendre (et Vendu/Renvoyé quand c'est l'étape) affichées côte à
côte ; l'étape actuelle est pleine (accent), les précédentes en vert pâle. Un clic garde le comportement actuel
(fenêtre « Passer à … » quand l'étape demande un montant).

## 4. Accueil (option 3)

- Titre : **« Quel article as-tu repéré ? »** (remplace « Closyria » en double et la phrase « arrive bientôt »).
- Champ « Colle son lien ici » + « Ajouter », plus compact qu'aujourd'hui (largeur ~560 px, hauteur standard).
- Dessous, **résumé du dressing** en cases cliquables : *commandés en route* (→ Commandé), *envies*
  (→ Envies), *dans ton dressing* (→ Dressing), *à vendre* (→ À vendre), pour le profil courant. Une case à zéro
  reste affichée (elle invite à commencer). Pas de case « baisses de prix » tant que les alertes de prix n'existent
  pas (chantier des alertes) ; elle s'ajoutera alors.
- Puis « Derniers liens », inchangé.
- Aligné à gauche (plus de texte centré).

## 5. Données

- `GET /api/me/summary` renvoie en plus, par profil, le nombre d'articles actifs par étape
  (`stageCounts: { spotted, ordered, owned, for_sale, sold, returned }`). Une seule requête groupée.
  Ces nombres alimentent les compteurs du menu et les cases de l'accueil ; ils se rafraîchissent comme le résumé
  aujourd'hui (arrivée, retour sur la fenêtre) et après un changement d'étape, un ajout ou une suppression.

## 6. Hors périmètre de cette passe

Couleurs des profils et des étiquettes, pages Confidentialité / Conditions, design des listes et des grilles
(Envies, Dressing…), admin.
