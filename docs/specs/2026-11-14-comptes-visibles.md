# Comptes visibles et admin « Utilisatrices » (2026-11-14)

Retours de la fondatrice : « pas intuitif quand on n'a pas de compte d'avoir l'idée d'aller dans Compte pour créer ou
se connecter » ; « en partie admin, on ne voit aucun compte, pour un SaaS c'est chelou ». Complète la conception V1
(§7.5 Anonyme → compte, §8 Admin).

## A. Connexion toujours visible

- **Invitée** (session anonyme, ou aucune session) : la barre du haut montre « Se connecter » (bouton de 44 px) à la
  place du sélecteur de profil, sur toutes les pages de l'app, téléphone et ordinateur. Il ouvre la page de connexion /
  création de compte existante (`/connexion`), qui ramène à la page d'où elle vient (`next`).
- Une invitée qui a déjà plusieurs profils (possible sans compte) garde le sélecteur, « Se connecter » à côté : sinon
  elle ne pourrait plus changer de profil.
- **Compte** : le sélecteur de profil reste.
- **Premier rendu** : le serveur voit si la requête porte un cookie de session. Sans cookie, c'est une invitée :
  « Se connecter » est là dès le premier rendu. Avec un cookie, une pastille neutre (sans texte) attend la lecture du
  résumé, qui dit invitée ou compte ; une lecture échouée ne change rien. Les pages de l'app sont donc rendues à la
  demande (elles lisent les cookies).
- **Accueil, invitée seulement** : bandeau discret « Crée ton compte pour garder tes articles sur tous tes appareils » +
  « Créer mon compte », avec une croix « Fermer ». Fermé, il ne revient pas avant 30 jours dans ce navigateur
  (`localStorage`, lectures et écritures protégées). Il s'efface si la proposition de compte G6 s'affiche déjà.
- Ses données d'invitée la suivent : c'est la liaison existante (`onLinkAccount` → registre des tables possédées), rien
  de nouveau.

## B. /admin sans session

- Aucune session, ou une session anonyme : `/admin/*` renvoie vers `/connexion?next=<adresse admin demandée>`.
- Compte connecté sans le rôle admin : toujours 404 (R15 inchangé).
- Admin sans clé d'accès : page « clé d'accès requise » existante.
- Décidé côté serveur dans les layouts et chaque page admin ; l'adresse demandée vient de `proxy.ts` (en-tête réécrit à
  chaque requête, puis nettoyé par `safeNext`). Une vérification de session en échec reste un 404. Routes d'API admin
  inchangées (401/403).

## C. Admin « Utilisatrices »

- `/admin/utilisatrices` (entrée de menu « Utilisatrices ») : e-mail ou « Sans compte », rôle, création, dernière
  activité (dernière mise à jour de session ou dernier événement), articles hors corbeille, appareils notifiés.
  Recherche par e-mail (comptes seulement : l'adresse générée d'une invitée ne veut rien dire), filtre Comptes / Sans
  compte, du plus récent au plus ancien, 50 par page avec curseur. Les nombres viennent d'une seule requête.
- `/admin/utilisatrices/{id}` : les mêmes faits, plus profils, listes, envies et possédés (hors corbeille), sessions,
  moyens de connexion (clé d'accès, Google, Apple, code par e-mail). **Jamais le contenu** : ni articles, ni listes,
  ni étiquettes nommés.
- « Supprimer ce compte » (sur demande, RGPD) : il faut taper son e-mail (« SUPPRIMER » pour une invitée), vérifié aussi
  par l'API ; journalisé (`user.delete`, cible `user:<id>`, sans l'e-mail). Une admin ne peut supprimer ni son compte ni
  celui d'une autre admin.
- Suppression : il n'existait pas de chemin de suppression de compte. `deleteUserAccount` (API) supprime la ligne
  `user` : toutes les tables qui pointent vers elle sont en `ON DELETE CASCADE` (vérifié par `owned-tables.test.ts`),
  sauf le journal d'audit et le journal des captures, qui la perdent (`SET NULL`). Ses codes de connexion en attente
  partent aussi. Ses photos stockées (médias, imports prêts) sont effacées du stockage après la validation ; un échec
  du stockage est journalisé et laisse un fichier orphelin, sans annuler la suppression (8 effacements à la fois).
- La ligne du journal d'audit est écrite dans la même transaction que la suppression : pas de suppression sans trace,
  pas de trace d'une suppression annulée. Le rôle admin est revérifié sous le verrou de la ligne.
- Reste après elle, sans lien : `email_rate_limit`, le compteur d'envois de codes par e-mail. Il est pseudonyme (HMAC de
  l'adresse avec le secret d'auth, jamais l'adresse) et de courte durée (fenêtre d'une heure, purgé 24 h après).
- « Dernière activité » lit ses événements par l'index `events(user_id, occurred_at)` (migration 0034, qui remplace
  l'index sur `user_id` seul).
- Formules et consommation : chantier abonnements ; la fiche garde la place d'un bloc à côté de « Usage ».
