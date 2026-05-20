.PHONY: help init start stop restart status logs backup restore update dashboard doctor preflight clean

PROFILE ?= basic
COMPOSE_FILES := -f docker-compose.yml -f docker-compose.$(PROFILE).yml
COMPOSE_DASHBOARD := -f docker-compose.dashboard.yml
COMPOSE_CMD := docker compose --env-file .env $(COMPOSE_FILES)
COMPOSE_ALL := docker compose --env-file .env $(COMPOSE_FILES) $(COMPOSE_DASHBOARD)

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

init: ## First-time setup
	@./scripts/setup.sh

start: preflight ## Start the battlegroup
	$(COMPOSE_ALL) up -d

stop: ## Stop the battlegroup
	$(COMPOSE_ALL) down

restart: ## Restart the battlegroup
	$(COMPOSE_ALL) restart

status: ## Show service status
	$(COMPOSE_ALL) ps

logs: ## Show logs (usage: make logs SERVICE=survival_1)
	$(COMPOSE_ALL) logs -f $(SERVICE)

backup: ## Create database backup
	@./scripts/backup.sh

restore: ## Restore database backup (usage: make restore FILE=path/to/backup.dump)
	@./scripts/restore.sh $(FILE)

update: ## Update Funcom server images
	@./scripts/update.sh

dashboard: ## Open dashboard in browser
	@xdg-open http://localhost:$(or $(DUNE_ADMIN_HOST_PORT),18080) 2>/dev/null || echo "Dashboard: http://localhost:$(or $(DUNE_ADMIN_HOST_PORT),18080)"

doctor: ## Run diagnostics
	@./scripts/health-check.sh

preflight: ## Pre-start validation
	@./scripts/preflight.sh

build-dashboard: ## Build dashboard images
	docker compose -f docker-compose.dashboard.yml build

clean: ## Remove all containers and volumes (DESTRUCTIVE)
	@echo "WARNING: This will delete all data including world saves!"
	@read -p "Are you sure? (yes/no): " confirm && [ "$$confirm" = "yes" ] && $(COMPOSE_ALL) down -v || echo "Cancelled."

db-init: ## Run database initialization
	$(COMPOSE_CMD) run --rm db-init
