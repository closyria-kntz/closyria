# Retours des tests du chantier 2a (dev, 2026-11-06)

Remarques de la fondatrice après les tests en dev, avec la réponse proposée. Statut de chaque point entre crochets.

## Déjà fait

- **Caractéristiques absentes de la fiche** [livré en dev, `77a3e1f`] : bloc « Caractéristiques » en lecture seule
  (type, couleur, matière, motif, saison).
- **Description absente** [prêt, à déployer] : la description de la boutique s'affiche, repliée sur 4 lignes, avec
  « Lire la suite ».

## Finitions du 2a (proposées avant la prod)

1. **Fiche perdue quand on colle un lien sans rien garder.** Aujourd'hui, une fiche ouverte mais pas gardée n'est
   retrouvable nulle part. Proposition : « Derniers liens » sur l'accueil (les 20 dernières fiches ouvertes par
   l'utilisatrice, sans rien ranger dans Envies). Les lectures enregistrent déjà qui les a demandées
   (`captures.requested_by`) : pas de nouvelle table.
2. **Retirer le ♡ laisse l'article dans Envies.** Aujourd'hui, ♡ crée l'article à l'étape « Envie » ; retirer le ♡
   enlève seulement le favori, l'article reste dans Envies. Proposition : si l'article est une simple envie sans rien
   d'autre (pas de liste, d'étiquette, de note, de taille, de photo à elle), retirer le ♡ le retire (avec
   « Annuler » pendant 8 s) et la fiche revient aux boutons « Garder cet article ». Sinon, seul le favori est retiré.
3. **Visionneuse de photos.** Un clic sur une photo l'ouvre en grand (plein écran), on passe d'une photo à l'autre en
   glissant (téléphone), avec les flèches ou le clavier ; un second clic montre la photo en taille réelle (on se
   déplace dedans) ; Échap ou ✕ ferme. Fiche boutique, article gardé et liste partagée.
4. **Ajout d'une photo dans une fenêtre unique.** Une seule fenêtre « Ajouter une photo » : coller une image
   (Ctrl/Cmd+V), la glisser-déposer, choisir un fichier ou prendre une photo (téléphone), ou donner un lien vers une
   image. Le lien est lu par le serveur avec les protections de la capture (`safeFetch` : adresses privées refusées,
   5 Mo, 15 s, type image vérifié) puis passe par la même vérification que les envois.
5. **Fiche « brouillon », sans structure.** Proposition : deux parties nettement séparées. En haut, l'essentiel
   (boutique, marque, nom, prix, « Voir chez … »). Puis « Mon article » (étapes, taille, montants, notes, listes,
   étiquettes, profil) dans un encadré à part, et « La fiche de la boutique » (tailles, caractéristiques,
   description). Actions rares (déplacer, supprimer) regroupées en bas.

## Passe design (avant l'ouverture au public)

- **Menu à revoir** (onglets téléphone, menu latéral ordinateur).
- Mise en page générale de la fiche et des vues, couleurs des profils et des étiquettes (décision déjà en attente).
- Les remarques de design notées pendant les tests s'ajoutent ici.

## Hors 2a

- Correction des caractéristiques par l'utilisatrice pour elle seule : **2b**.
