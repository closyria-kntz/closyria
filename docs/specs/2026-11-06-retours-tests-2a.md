# Retours des tests du chantier 2a (dev, 2026-11-06)

Remarques de la fondatrice après les tests en dev, avec la réponse proposée. Statut de chaque point entre crochets.

## Déjà fait

- **Caractéristiques absentes de la fiche** [livré en dev, `77a3e1f`] : bloc « Caractéristiques » en lecture seule
  (type, couleur, matière, motif, saison).
- **Description absente** [livré en dev, `3318e6e`] : la description de la boutique s'affiche, repliée sur 4 lignes, avec
  « Lire la suite ».

## Finitions du 2a (proposées avant la prod ; plan `docs/plans/2026-11-06-finitions-2a.md`)

1. **Fiche perdue quand on colle un lien sans rien garder.** [fait sur la branche `finitions-2a`, pas encore fusionné dans `dev`] Aujourd'hui, une fiche ouverte mais pas gardée n'est
   retrouvable nulle part. Proposition : « Derniers liens » sur l'accueil (les 20 dernières fiches ouvertes par
   l'utilisatrice, sans rien ranger dans Envies). Une petite table `recent_products` (une ligne par utilisatrice
   et fiche) : `captures.requested_by` ne suffit pas, une lecture déjà en cours n'écrit pas de ligne pour la
   seconde personne.
2. **Retirer le ♡ laisse l'article dans Envies.** [fait sur la branche `finitions-2a`, pas encore fusionné dans `dev`] Aujourd'hui, ♡ crée l'article à l'étape « Envie » ; retirer le ♡
   enlève seulement le favori, l'article reste dans Envies. Proposition : si l'article est une simple envie sans rien
   d'autre (pas de liste, d'étiquette, de note, de taille, de photo à elle), retirer le ♡ le retire (avec
   « Annuler » pendant 8 s) et la fiche revient aux boutons « Garder cet article ». Sinon, seul le favori est retiré.
3. **Visionneuse de photos.** [fait sur la branche `finitions-2a`, pas encore fusionné dans `dev`] Un clic sur une photo l'ouvre en grand (plein écran), on passe d'une photo à l'autre en
   glissant (téléphone), avec les flèches ou le clavier ; un second clic montre la photo en taille réelle (on se
   déplace dedans) ; Échap ou ✕ ferme. Fiche boutique, article gardé et liste partagée.
4. **Ajout d'une photo dans une fenêtre unique.** [fait sur la branche `finitions-2a`, pas encore fusionné dans `dev`] Une seule fenêtre « Ajouter une photo » : coller une image
   (Ctrl/Cmd+V), la glisser-déposer, choisir un fichier ou prendre une photo (téléphone), ou donner un lien vers une
   image. Le lien est lu par le worker (seul processus derrière la barrière réseau) avec `safeFetch` (adresses
   privées refusées, 20 Mo, 15 s, type image vérifié), puis l'image passe par le même réencodage que les envois.
5. **Fiche « brouillon », sans structure.** [fait sur la branche `finitions-2a`, pas encore fusionné dans `dev`] Proposition : deux parties nettement séparées. En haut, l'essentiel
   (boutique, marque, nom, prix, « Voir chez … »). Puis « Mon article » (étapes, taille, montants, notes, listes,
   étiquettes, profil) dans un encadré à part, et « La fiche de la boutique » (tailles, caractéristiques,
   description). Actions rares (déplacer, supprimer) regroupées en bas.

## Retours des tests des finitions (dev, 2026-11-06)

- ♡ retiré, ajout de photo : OK.
- **Visionneuse** [corrigé] : la barre du haut (compteur, « Taille réelle », « Fermer ») tombait sous la photo, hors
  de l'écran, avec une barre de défilement verticale (`top-0`/`inset-x-0` n'existent pas dans l'échelle d'espacement).
  Elle est maintenant en haut, « Fermer » en haut à droite, sans défilement.
- **Pas d'accueil dans le menu** [corrigé] : l'accueil (coller un lien, Derniers liens) était une page à part, sans
  menu, et le menu n'avait pas d'« Accueil ». L'accueil est maintenant dans le même cadre : « Accueil » en tête du
  menu, 5 onglets sur téléphone (Accueil, Envies, Commandé, Dressing, Plus) ; « + Ajouter » est masqué sur l'accueil.
- **Visionneuse, 2e passage** [corrigé] : la barre verticale était celle de la page derrière ; la page ne défile plus
  tant qu'une fenêtre est ouverte (visionneuse, « Ajouter une photo »). Un clic à côté de la photo ferme.
- **Description sans la mise en forme du site** [corrigé] : paragraphes, retours à la ligne et listes (« • ») sont
  gardés, en texte seul (gras, liens et couleurs non repris : pas de HTML de boutique stocké). Nouvelles fiches, et
  les anciennes à leur prochaine relecture.
- Structure de la fiche : mieux, design à revoir (Passe design).
- **Ordre de la fiche, « Mon article », « Autres actions », largeur sur PC** : la fiche boutique en bas paraît
  bizarre, « Mon article » et « Autres actions » sont à redessiner, et sur grand écran le contenu reste au centre au
  lieu d'utiliser la largeur. À traiter ensemble dans la Passe design (maquettes à valider d'abord).

## Passe design (avant l'ouverture au public)

- **Menu à revoir** (onglets téléphone, menu latéral ordinateur). L'accueil y est depuis le 2026-11-06.
- Design de la fiche (trois parties en place, à embellir) ; accueil : titre « Closyria » en double et phrase
  « arrive bientôt » à revoir.
- Mise en page générale de la fiche et des vues, couleurs des profils et des étiquettes (décision déjà en attente).
- Les remarques de design notées pendant les tests s'ajoutent ici.

## Hors 2a

- Correction des caractéristiques par l'utilisatrice pour elle seule : **2b**.

## Reste à faire (relevé par la revue finale de `finitions-2a`)

- Une photo ajoutée par lien sur un article mis à la corbeille avant d'être rattachée est perdue si une liste est
  lue avant la restauration. Correction prévue : ne rattacher que les imports des articles actifs.
- Quand l'attente de la photo par lien s'arrête, le message dit « dans un instant », mais la fiche ne se recharge
  pas seule : la photo n'apparaît qu'au prochain chargement. Renvoyer le même lien peut l'ajouter deux fois.
