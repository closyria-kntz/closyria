# Mon compte : savoir qui est connectée, se déconnecter

Date : 2026-11-07 · Statut : validé par la fondatrice (« oui, fais le compte en dev »), livré en dev.

## Constat

La conception V1 prévoyait la connexion (code par e-mail, Google, Apple) et le passage anonyme → compte, mais rien pour
savoir **sur quel compte on est** ni pour **se déconnecter**. Relevé par la fondatrice pendant les tests de la Passe
design.

## Décisions

1. **Toujours visible.** En bas du menu de gauche (ordinateur) et à la fin de « Plus » (téléphone) : une ligne
   « Mon compte » avec l'adresse e-mail, ou « Sans compte ». Sur tablette, « Mon compte » est dans les réglages.
2. **Page « Mon compte »** (`/reglages/compte`, aussi dans le sous-menu des réglages) :
   - avec un compte : adresse e-mail, « Compte créé le … », bouton **« Se déconnecter »** → page de connexion ;
   - sans compte : « Tu utilises Closyria sans compte. », explication, bouton « Créer mon compte » (retour sur la page
     après connexion).
3. **Pas de déconnexion sans compte** : la session anonyme est le seul lien vers ses articles, la fermer les perdrait.
4. Après la déconnexion, un retour dans l'application crée une nouvelle visite sans compte (comportement existant).

## Technique

- `GET /api/me/summary` renvoie `account: { email, createdAt }`, lus dans la table `user` (l'e-mail est `null` sans
  compte : jamais l'adresse provisoire de la session anonyme).
- Le cadre de l'application garde `account` dans son contexte (`useAccount()`) ; une visiteuse sans session encore
  est « Sans compte ».
- Déconnexion : `signOut()` de Better Auth, puis rechargement complet de `/connexion`.

## Tests

- API : `profiles.integration.test.ts` (« gives a real account's e-mail and creation date… »).
- Parcours : `e2e/tests/account.spec.ts` (sans compte, avec compte + déconnexion, téléphone), axe sans violation.

## Plus tard

- Changer d'adresse e-mail, supprimer son compte (prévu avec les textes légaux, chantier 6).
- Lier Google / Apple depuis cette page quand ces connexions seront ouvertes.
