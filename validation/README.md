# SmartBudget GPS — PWA privée

La PWA 2.5.3 affiche directement l’interface et utilise Google Identity Services pour appeler un déploiement API Apps Script privé. Le moteur financier demeure en version 2.5.1 dans le projet Apps Script du propriétaire.

## Configuration

`config.json` contient uniquement un ID client OAuth public, l’URL du déploiement API et la version de la PWA. Le client OAuth et le script utilisent le même projet Google Cloud. L’origine JavaScript autorisée est l’origine de ce site GitHub Pages. Le déploiement API doit rester accessible uniquement à son propriétaire.

La connexion demande les trois scopes déjà déclarés par le script : Sheets, interface du classeur, requêtes externes. Le jeton Google demeure en mémoire, expire et n’est jamais enregistré dans le cache du service worker. La session PIN existante demeure propre à la session du navigateur. Les brouillons d’opérations en attente suivent le mécanisme existant de récupération et d’idempotence.

## Comportement

Une requête nulle à `api_request` vérifie le contrat et l’accès au déploiement sans lire les données financières, tester le PIN ni modifier Sheets. Le code attendu renvoie « Requête invalide. ». L’utilisateur saisit ensuite son PIN existant. Les erreurs Google, annulations, refus de permissions, expirations et délais ont des messages explicites. Une écriture n’est jamais répétée automatiquement.

Le service worker ne met en cache que les fichiers statiques explicitement listés. Il exclut la configuration, les API Google, les jetons et les données financières. La PWA nécessite Internet pour consulter des données fraîches et enregistrer une opération.

## Validation

Les tests de transport se lancent avec `node --test tests/oauth.test.cjs`. Ils utilisent exclusivement des réponses synthétiques. La connexion Google réelle, l’accès au déploiement privé et l’installation Android nécessitent une validation sous le compte propriétaire sur les appareils cibles. Des tests locaux ne prouvent pas ce fonctionnement réel.

La version 2.5.3 utilise le nouveau déploiement du propriétaire après migration de sa configuration Google. L’accès réel au nouveau backend reste à valider sur PC et Android. L’application déjà installée doit être réouverte avec la nouvelle version ; aucune réinstallation n’est requise pour le changement de configuration.

La version précédente de l’accueil intégré est conservée dans l’historique Git au commit `a083fa84be6a0b0495e28307d33a9db45f2ee8b2`. Aucun code backend, fichier de données, PIN ou secret client n’est publié dans ce dépôt.


## Compte habituel

La connexion ne force plus le sélecteur de comptes Google. Un lien de configuration personnel peut transmettre le compte habituel par le fragment `#account=...`, lequel ne fait pas partie de la requête HTTP au serveur. Seule cette préférence non secrète est mémorisée dans le stockage local de l’appareil ; le fragment est retiré de l’adresse affichée. L’adresse du propriétaire n’est pas inscrite dans les fichiers publics du dépôt. Si le stockage est indisponible, la préférence est conservée en mémoire pour cette ouverture. Google peut toujours demander une connexion ou une vérification de sécurité. La préférence ne remplace jamais l’autorisation du backend privé.

## État de la migration

Le classeur a été restauré par copie native de la sauvegarde du 7 octobre 2026, avant mise en service. Les modifications postérieures à cette sauvegarde doivent être revalidées. Le moteur 2.5.1 a été adapté uniquement pour le nouvel identifiant du classeur. Les optimisations des appels d’enregistrement restent une étape distincte.
