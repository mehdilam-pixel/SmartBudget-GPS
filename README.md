# SmartBudget GPS — PWA privée

La PWA 2.5.2 affiche directement l’interface et utilise Google Identity Services pour appeler un déploiement API Apps Script privé. Le moteur financier demeure en version 2.5.1 dans le projet Apps Script du propriétaire.

## Configuration

`config.json` contient uniquement un ID client OAuth public, l’URL du déploiement API et la version de la PWA. Le client OAuth et le script utilisent le même projet Google Cloud. L’origine JavaScript autorisée est l’origine de ce site GitHub Pages. Le déploiement API doit rester accessible uniquement à son propriétaire.

La connexion demande les trois scopes déjà déclarés par le script : Sheets, interface du classeur, requêtes externes. Le jeton Google demeure en mémoire, expire et n’est jamais enregistré dans le cache du service worker. La session PIN existante demeure propre à la session du navigateur. Les brouillons d’opérations en attente suivent le mécanisme existant de récupération et d’idempotence.

## Comportement

Une requête nulle à `api_request` vérifie le contrat et l’accès au déploiement sans lire les données financières, tester le PIN ni modifier Sheets. Le code attendu renvoie « Requête invalide. ». L’utilisateur saisit ensuite son PIN existant. Les erreurs Google, annulations, refus de permissions, expirations et délais ont des messages explicites. Une écriture n’est jamais répétée automatiquement.

Le service worker ne met en cache que les fichiers statiques explicitement listés. Il exclut la configuration, les API Google, les jetons et les données financières. La PWA nécessite Internet pour consulter des données fraîches et enregistrer une opération.

## Validation

Les tests de transport se lancent avec `node --test tests/oauth.test.cjs`. Ils utilisent exclusivement des réponses synthétiques. La connexion Google réelle, l’accès au déploiement privé et l’installation Android nécessitent une validation sous le compte propriétaire sur les appareils cibles. Des tests locaux ne prouvent pas ce fonctionnement réel.

Le 8 octobre 2026, le propriétaire a confirmé l’affichage de l’Aperçu après connexion Google et PIN sur PC puis sur Android, à l’adresse de validation. La même version est promue à l’adresse principale pour l’installation. L’installation Android et le lancement depuis l’icône restent à confirmer.

La version précédente de l’accueil intégré est conservée dans l’historique Git au commit `a083fa84be6a0b0495e28307d33a9db45f2ee8b2`. Aucun code backend, fichier de données, PIN ou secret client n’est publié dans ce dépôt.
