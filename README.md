# SmartBudget Fintech GPS — installation Android

Coque PWA 2.5.1 reliée au déploiement Google Apps Script GPS.

Ce dépôt contient uniquement la page d’installation, sa configuration de connexion, le manifeste et les icônes. Aucun journal, montant initial, créancier, classeur, code du backend, PIN ou jeton de session n’y est inclus.

Le lien Google dans config.json est l’adresse du service, pas un secret d’authentification. L’accès au service reste contrôlé par Google et par le PIN de l’application. L’accès Google doit conserver la configuration « Moi uniquement ».

## Publication

Publier la branche main, dossier racine, dans Settings → Pages → Deploy from a branch. Les chemins sont relatifs pour fonctionner dans le sous-dossier du dépôt GitHub Pages.

## Android

Ouvrir le site dans Chrome connecté au compte Google propriétaire du backend. Tester l’ouverture et le PIN, puis installer depuis Chrome. Le lien « Ouvrir avec mon compte Google » fournit une ouverture directe si l’authentification intégrée est bloquée. Ce recours peut ouvrir un onglet du navigateur ; le comportement de connexion et de retour à l’application installée doit être vérifié sur le téléphone réel.

## Cache et fonctionnement

Seuls la coque et les icônes sont mis en cache par ce service worker. Ni la configuration, ni les appels externes Google, ni les soldes ne sont mis en cache. Une connexion Internet est nécessaire pour le budget. Installer la PWA ne modifie pas le temps d’exécution du backend Google.

## État

Backend GPS 2.5.1 confirmé par l’utilisateur le 7 octobre 2026. Fichiers PWA préparés et tests locaux de connexion exécutés. Publication GitHub Pages, authentification intégrée et installation Android restent à vérifier.
