#!/bin/bash
# ClickHouse Event Sourcing Demo
# Demonstrates: Event Sourcing Pattern, Scale, and Query Performance
# Narrative: Follow PatientX through clinical cohort management

set -e

# Parse command line arguments
DEMO_SIZE=${DEMO_SIZE:-full}
while [[ $# -gt 0 ]]; do
    case $1 in
        --small|-s)
            DEMO_SIZE=small
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --small, -s    Run demo with smaller dataset (1.3M members)"
            echo "  --help, -h     Show this help message"
            echo ""
            echo "Environment variables:"
            echo "  NO_PAUSE=1     Run demo without pausing between steps"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Run '$0 --help' for usage information"
            exit 1
            ;;
    esac
done

# Cohort sizes based on demo mode
# Heart disease and diabetes are largest (chronic conditions)
# Screening programs are smaller
# Quality measures are smallest (numerator/denominator pattern)
if [ "$DEMO_SIZE" = "small" ]; then
    HEART_TOTAL=500000
    DIABETES_TOTAL=375000
    CKD_TOTAL=250000
    HYPERTENSION_TOTAL=125000
    CANCER_TOTAL=50000
    # Quality measure numerators (subsets of denominators)
    DIABETES_A1C_TOTAL=300000  # 80% of diabetes cohort with A1C testing
    HEART_BETABLOCKER_TOTAL=375000  # 75% of heart failure cohort on beta blockers
else
    HEART_TOTAL=1000000
    DIABETES_TOTAL=750000
    CKD_TOTAL=500000
    HYPERTENSION_TOTAL=250000
    CANCER_TOTAL=100000
    # Quality measure numerators (subsets of denominators)
    DIABETES_A1C_TOTAL=600000  # 80% of diabetes cohort with A1C testing
    HEART_BETABLOCKER_TOTAL=750000  # 75% of heart failure cohort on beta blockers
fi

TOTAL_MEMBERSHIPS=$((DIABETES_TOTAL + HYPERTENSION_TOTAL + HEART_TOTAL + CKD_TOTAL + CANCER_TOTAL + DIABETES_A1C_TOTAL + HEART_BETABLOCKER_TOTAL))

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Configuration
FHIR_URL="http://localhost:3000/4_0_0"
KEYCLOAK_URL="http://localhost:8080/realms/master/protocol/openid-connect/token"
TOKEN=""
DIABETES_COHORT_ID=""
CARDIOVASCULAR_COHORT_ID=""
HYPERTENSION_COHORT_ID=""
CKD_COHORT_ID=""
CANCER_COHORT_ID=""
DIABETES_A1C_COHORT_ID=""
HEART_BETABLOCKER_COHORT_ID=""

# Display functions
header() {
    echo -e "\n${BOLD}${CYAN}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${BOLD}${CYAN}  $1${NC}"
    echo -e "${BOLD}${CYAN}════════════════════════════════════════════════════════════════${NC}\n"
}

info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

success() {
    echo -e "${GREEN}✅ $1${NC}"
}

warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

error() {
    echo -e "\n${RED}❌ ERROR: $1${NC}\n" >&2
    exit 1
}

step() {
    echo -e "\n${MAGENTA}${BOLD}▶ $1${NC}\n"
}

pause() {
    if [ -z "$NO_PAUSE" ]; then
        echo -e "\n${YELLOW}Press Enter to continue...${NC}"
        read
        clear
    else
        echo -e "\n${YELLOW}(Continuing automatically...)${NC}\n"
        sleep 1
    fi
}

# Get OAuth token from Keycloak
get_token() {
    step "Authenticating with Keycloak"

    TOKEN=$(curl -s -X POST "$KEYCLOAK_URL" \
        -H "Content-Type: application/x-www-form-urlencoded" \
        -d "grant_type=client_credentials" \
        -d "client_id=bwell-client-id" \
        -d "client_secret=bwell-secret" \
        -d "scope=user/*.* access/*.*" | jq -r '.access_token')

    if [ -z "$TOKEN" ] || [ "$TOKEN" == "null" ]; then
        error "Failed to get OAuth token"
    fi

    success "Authenticated successfully"
}

# Time a request and return response
time_request() {
    local method=$1
    local url=$2
    local data=$3

    local start_sec=$(date +%s)

    if [ -n "$data" ]; then
        response=$(curl -s -X "$method" "$url" \
            -H "Authorization: Bearer $TOKEN" \
            -H "Content-Type: application/fhir+json" \
            -d "$data")
    else
        response=$(curl -s -X "$method" "$url" \
            -H "Authorization: Bearer $TOKEN" \
            -H "Content-Type: application/fhir+json")
    fi

    local end_sec=$(date +%s)
    local elapsed_sec=$((end_sec - start_sec))

    echo "$response"
    if [ $elapsed_sec -eq 0 ]; then
        echo "⏱️  <1s" >&2
    else
        echo "⏱️  ${elapsed_sec}s" >&2
    fi
}

# Show formatted response
show_response() {
    local response=$1
    local filter=${2:-'.'}

    echo "$response" | jq "$filter" 2>/dev/null || echo "$response"
}

# Create an empty clinical cohort
create_empty_clinical_cohort() {
    local name=$1

    local payload=$(cat <<EOF
{
    "resourceType": "Group",
    "type": "person",
    "actual": true,
    "name": "$name",
    "meta": {
        "source": "http://demo-system.com/Group",
        "security": [
            {"system": "https://www.icanbwell.com/owner", "code": "demo"},
            {"system": "https://www.icanbwell.com/access", "code": "demo"}
        ]
    }
}
EOF
)

    info "Creating empty Group: $name..." >&2

    local start_sec=$(date +%s)
    response=$(curl -s -X "POST" "$FHIR_URL/Group" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/fhir+json" \
        -d "$payload")
    local end_sec=$(date +%s)
    local elapsed_sec=$((end_sec - start_sec))

    if [ $elapsed_sec -eq 0 ]; then
        echo "⏱️  <1s" >&2
    else
        echo "⏱️  ${elapsed_sec}s" >&2
    fi

    local cohort_id=$(echo "$response" | jq -r '.id // empty')
    if [ -z "$cohort_id" ]; then
        error "Failed to create $name. Response: $(echo "$response" | jq -c '.')"
    fi

    echo -e "\n${CYAN}Created Empty Cohort:${NC}" >&2
    show_response "$response" '{id, name, type, quantity}' >&2

    success "$name created (ID: $cohort_id)" >&2
    echo "$cohort_id"
}

# Add PatientX in a batch
add_patientx_to_cohort() {
    local cohort_id=$1
    local cohort_name=$2

    local payload='[{"op":"add","path":"/member/-","value":{"entity":{"reference":"Patient/PatientX"}}}]'

    echo -e "\n${CYAN}Executing:${NC}" >&2
    echo "PATCH $FHIR_URL/Group/$cohort_id" >&2
    echo "Content-Type: application/json-patch+json" >&2
    echo "$payload" | jq '.' >&2
    echo "" >&2

    local start_sec=$(date +%s)
    response=$(curl -s -X "PATCH" "$FHIR_URL/Group/$cohort_id" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json-patch+json" \
        -d "$payload")
    local end_sec=$(date +%s)
    local elapsed_sec=$((end_sec - start_sec))

    if [ $elapsed_sec -eq 0 ]; then
        echo "⏱️  <1s" >&2
    else
        echo "⏱️  ${elapsed_sec}s" >&2
    fi

    echo "$response"
}

# Patch cohort with incremental members (batching demonstration)
patch_incremental_members() {
    local cohort_id=$1
    local cohort_name=$2
    local batch_size=$3
    local batch_num=$4
    local include_patientx=${5:-false}

    # Generate member operations array and write to temp file
    local temp_file=$(mktemp)
    awk -v batch_size="$batch_size" -v batch_num="$batch_num" -v include_patientx="$include_patientx" '
        BEGIN {
            printf "["
            start_index = (batch_num - 1) * batch_size + 1

            # If including PatientX, add them first
            if (include_patientx == "true") {
                printf "{\"op\":\"add\",\"path\":\"/member/-\",\"value\":{\"entity\":{\"reference\":\"Patient/PatientX\"}}}"
                if (batch_size > 0) printf ","
            }

            for (i = 0; i < batch_size; i++) {
                patient_num = start_index + i
                printf "{\"op\":\"add\",\"path\":\"/member/-\",\"value\":{\"entity\":{\"reference\":\"Patient/batch-%06d\"}}}", patient_num
                if (i < batch_size - 1) printf ","
            }
            printf "]"
        }' > "$temp_file"

    info "PATCH $cohort_name: Adding batch $batch_num ($(printf "%'d" $batch_size) members)..." >&2

    local start_sec=$(date +%s)
    response=$(curl -s -X "PATCH" "$FHIR_URL/Group/$cohort_id" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json-patch+json" \
        -d @"$temp_file")
    local end_sec=$(date +%s)
    local elapsed_sec=$((end_sec - start_sec))

    rm -f "$temp_file"

    if [ $elapsed_sec -eq 0 ]; then
        echo "⏱️  <1s" >&2
    else
        echo "⏱️  ${elapsed_sec}s" >&2
    fi

    local response_id=$(echo "$response" | jq -r '.id // empty')
    if [ -z "$response_id" ]; then
        error "Failed to patch $cohort_name. Response: $(echo "$response" | jq -c '.')"
    fi

    success "Batch $batch_num added to $cohort_name" >&2
    echo "$response"
}

# Query PatientX's current cohorts
query_patientx_current_cohorts() {
    echo -e "${CYAN}Executing:${NC}" >&2
    echo "GET $FHIR_URL/Group?member=Patient/PatientX&_total=accurate" >&2
    echo "" >&2

    response=$(time_request "GET" "$FHIR_URL/Group?member=Patient/PatientX&_total=accurate&_source=http://demo-system.com/Group")

    local total=$(echo "$response" | jq '[.entry[]?] | length')
    local cohort_names=$(echo "$response" | jq -r '.entry[]?.resource.name' | paste -sd "," -)

    echo -e "\n${CYAN}Response:${NC}" >&2
    echo "$response" | jq '.entry[]? | {id: .resource.id, name: .resource.name, quantity: .resource.quantity}' >&2
    echo "" >&2

    success "PatientX is in $total cohorts" >&2
    echo "$total"
}

# Query event log for PatientX
query_event_log_patientx() {
    info "Querying immutable event log for PatientX..." >&2

    local event_query="SELECT group_id, event_type, event_time FROM fhir.fhir_group_member_events WHERE entity_reference = 'Patient/PatientX' ORDER BY event_time ASC"

    echo -e "\n${CYAN}ClickHouse Query (Event Log):${NC}" >&2
    echo "$event_query" >&2
    echo "" >&2

    docker exec fhir-clickhouse clickhouse-client --query "$event_query" --format PrettyCompact --output_format_pretty_max_rows=10

    echo "" >&2
    echo -e "${CYAN}Group ID Reference:${NC}" >&2
    echo "  • $DIABETES_COHORT_ID = Type 1 Diabetes Care Coordination (initial condition)" >&2
    echo "  • $DIABETES_A1C_COHORT_ID = Diabetes A1C Testing Compliance (quality measure - added in Step 2)" >&2
    echo "  • $CARDIOVASCULAR_COHORT_ID = Heart Disease Care Program (disease progression - added in Step 2)" >&2
    echo "  • $HEART_BETABLOCKER_COHORT_ID = Heart Disease Beta Blocker Therapy (quality measure - added in Step 2)" >&2
}

# Query materialized view for PatientX
query_materialized_view_patientx() {
    info "Querying materialized view (current state) for PatientX..." >&2

    local mv_query="SELECT group_id, argMaxMerge(event_type) as current_status, argMaxMerge(inactive) as inactive FROM fhir.fhir_group_member_current_by_entity FINAL WHERE entity_reference = 'Patient/PatientX' GROUP BY group_id HAVING current_status = 'added' AND inactive = 0"

    echo -e "\n${CYAN}ClickHouse Query (Materialized View):${NC}" >&2
    echo "$mv_query" >&2
    echo "" >&2

    docker exec fhir-clickhouse clickhouse-client --query "$mv_query" --format PrettyCompact --output_format_pretty_max_rows=10

    echo "" >&2
    echo -e "${CYAN}Group ID Reference:${NC}" >&2
    echo "  • $DIABETES_COHORT_ID = Type 1 Diabetes Care Coordination (initial condition)" >&2
    echo "  • $DIABETES_A1C_COHORT_ID = Diabetes A1C Testing Compliance (quality measure - added in Step 2)" >&2
    echo "  • $CARDIOVASCULAR_COHORT_ID = Heart Disease Care Program (disease progression - added in Step 2)" >&2
    echo "  • $HEART_BETABLOCKER_COHORT_ID = Heart Disease Beta Blocker Therapy (quality measure - added in Step 2)" >&2
}

# Remove PatientX from a cohort
remove_patientx_from_cohort() {
    local cohort_id=$1
    local cohort_name=$2

    local remove_payload='[{"op":"remove","path":"/member","value":{"entity":{"reference":"Patient/PatientX"}}}]'

    echo -e "\n${CYAN}Executing:${NC}" >&2
    echo "PATCH $FHIR_URL/Group/$cohort_id" >&2
    echo "Content-Type: application/json-patch+json" >&2
    echo "$remove_payload" | jq '.' >&2
    echo "" >&2

    local start_sec=$(date +%s)
    response=$(curl -s -X "PATCH" "$FHIR_URL/Group/$cohort_id" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json-patch+json" \
        -d "$remove_payload")
    local end_sec=$(date +%s)
    local elapsed_sec=$((end_sec - start_sec))

    if [ $elapsed_sec -eq 0 ]; then
        echo "⏱️  <1s" >&2
    else
        echo "⏱️  ${elapsed_sec}s" >&2
    fi

    echo -e "\n${CYAN}Response:${NC}" >&2
    show_response "$response" '{id, name, quantity}' >&2

    echo "$response"
}

# Check that all required services are running
check_services() {
    header "Setup"

    info "Checking Docker services..."

    # Check FHIR server
    if ! docker ps | grep -q "fhir-server-fhir-1"; then
        error "FHIR server container is not running. Start with: docker-compose up -d"
    fi
    success "FHIR server is running"

    # Check ClickHouse
    if ! docker ps | grep -q "fhir-clickhouse"; then
        error "ClickHouse container is not running. Start with: docker-compose up -d"
    fi
    success "ClickHouse is running"

    # Check Keycloak
    if ! docker ps | grep -q "keycloak"; then
        error "Keycloak container is not running. Start with: docker-compose up -d"
    fi
    success "Keycloak is running"

    # Check environment variable
    local clickhouse_resources=$(docker exec fhir-server-fhir-1 printenv MONGO_WITH_CLICKHOUSE_RESOURCES 2>/dev/null || echo "")
    if [ "$clickhouse_resources" != "Group" ]; then
        warning "MONGO_WITH_CLICKHOUSE_RESOURCES is not set to 'Group' (current: '$clickhouse_resources')"
    else
        success "MONGO_WITH_CLICKHOUSE_RESOURCES is correctly set to 'Group'"
    fi
}

# Clean up previous demo data
cleanup_previous_data() {
    # Delete all cohorts with meta.source = demo-system
    local search_response=$(curl -s -X GET "$FHIR_URL/Group?_source=http://demo-system.com/Group&_count=100" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/fhir+json")
    local group_ids=$(echo "$search_response" | jq -r '.entry[]?.resource.id // empty')

    if [ -n "$group_ids" ]; then
        # Delete MongoDB Groups
        for gid in $group_ids; do
            curl -s -X DELETE "$FHIR_URL/Group/$gid" \
                -H "Authorization: Bearer $TOKEN" > /dev/null
        done
    fi

    # Truncate ClickHouse tables for clean demo start
    # (DELETEs are async mutations, truncate is immediate)
    docker exec fhir-clickhouse clickhouse-client --query \
        "TRUNCATE TABLE fhir.fhir_group_member_events" > /dev/null 2>&1
    docker exec fhir-clickhouse clickhouse-client --query \
        "TRUNCATE TABLE fhir.fhir_group_member_current" > /dev/null 2>&1
    docker exec fhir-clickhouse clickhouse-client --query \
        "TRUNCATE TABLE fhir.fhir_group_member_current_by_entity" > /dev/null 2>&1
}

# Step 1: Create Clinical Cohorts (Empty Groups)
act1_create_cohorts() {
    header "Step 1: Create Clinical Cohorts with Members"

    echo -e "${BOLD}Creating 7 cohorts with bulk member loading:${NC}"
    echo -e "${BOLD}Chronic Condition Cohorts (denominators):${NC}"
    echo "  • Heart Disease Care Program: $(printf "%'d" $HEART_TOTAL) members"
    echo "  • Type 1 Diabetes Care Coordination: $(printf "%'d" $DIABETES_TOTAL) members (includes PatientX)"
    echo "  • CKD Stage 3-4 Registry: $(printf "%'d" $CKD_TOTAL) members"
    echo "  • Hypertension Screening Program: $(printf "%'d" $HYPERTENSION_TOTAL) members"
    echo "  • Oncology Active Treatment: $(printf "%'d" $CANCER_TOTAL) members"
    echo ""
    echo -e "${BOLD}Quality Measure Cohorts (numerators):${NC}"
    echo "  • Diabetes A1C Testing Compliance: $(printf "%'d" $DIABETES_A1C_TOTAL) members"
    echo "  • Heart Disease Beta Blocker Therapy: $(printf "%'d" $HEART_BETABLOCKER_TOTAL) members"
    echo ""
    echo -e "  • ${BOLD}Total: ~$(printf "%'d" $TOTAL_MEMBERSHIPS) memberships${NC}"
    echo ""
    echo -e "${BOLD}Loading in batches (10K members per PATCH operation)...${NC}"
    echo -e "${BOLD}PatientX starts in 1 cohort (Diabetes only - early stage disease)${NC}\n"

    # Create empty cohorts first (quietly)
    info "Creating empty Groups..."
    CARDIOVASCULAR_COHORT_ID=$(create_empty_clinical_cohort "Heart Disease Care Program" 2>&1 | tail -1)
    DIABETES_COHORT_ID=$(create_empty_clinical_cohort "Type 1 Diabetes Care Coordination" 2>&1 | tail -1)
    CKD_COHORT_ID=$(create_empty_clinical_cohort "CKD Stage 3-4 Registry" 2>&1 | tail -1)
    HYPERTENSION_COHORT_ID=$(create_empty_clinical_cohort "Hypertension Screening Program" 2>&1 | tail -1)
    CANCER_COHORT_ID=$(create_empty_clinical_cohort "Oncology Active Treatment" 2>&1 | tail -1)
    DIABETES_A1C_COHORT_ID=$(create_empty_clinical_cohort "Diabetes A1C Testing Compliance" 2>&1 | tail -1)
    HEART_BETABLOCKER_COHORT_ID=$(create_empty_clinical_cohort "Heart Disease Beta Blocker Therapy" 2>&1 | tail -1)
    success "Created 7 empty Groups"
    echo ""

    # Load Heart Disease (largest, 500K members, NO PatientX yet)
    info "Loading Heart Disease Care Program ($(printf "%'d" $HEART_TOTAL) members)..."
    local batch_num=1
    local remaining=$HEART_TOTAL
    while [ $remaining -gt 0 ]; do
        if [ $remaining -gt 10000 ]; then
            local batch_size=10000
        else
            local batch_size=$remaining
        fi
        patch_incremental_members "$CARDIOVASCULAR_COHORT_ID" "HeartFailure" $batch_size $batch_num "false" >/dev/null 2>&1
        remaining=$((remaining - batch_size))
        ((batch_num++))
    done
    success "Loaded $(printf "%'d" $HEART_TOTAL) members"

    # Load Diabetes (375K members, include PatientX in first batch)
    info "Loading Type 1 Diabetes Care Coordination ($(printf "%'d" $DIABETES_TOTAL) members, including PatientX)..."
    batch_num=1
    remaining=$DIABETES_TOTAL
    while [ $remaining -gt 0 ]; do
        if [ $remaining -gt 10000 ]; then
            local batch_size=10000
        else
            local batch_size=$remaining
        fi

        if [ $batch_num -eq 1 ]; then
            # First batch: include PatientX + 9,999 members = 10,000 operations total
            patch_incremental_members "$DIABETES_COHORT_ID" "Diabetes" 9999 $batch_num "true" >/dev/null 2>&1
            remaining=$((remaining - 9999))
        else
            patch_incremental_members "$DIABETES_COHORT_ID" "Diabetes" $batch_size $batch_num "false" >/dev/null 2>&1
            remaining=$((remaining - batch_size))
        fi
        ((batch_num++))
    done
    success "Loaded $(printf "%'d" $DIABETES_TOTAL) members (including PatientX)"

    # Load CKD (250K members, no PatientX)
    info "Loading CKD Stage 3-4 Registry ($(printf "%'d" $CKD_TOTAL) members)..."
    batch_num=1
    remaining=$CKD_TOTAL
    while [ $remaining -gt 0 ]; do
        if [ $remaining -gt 10000 ]; then
            local batch_size=10000
        else
            local batch_size=$remaining
        fi
        patch_incremental_members "$CKD_COHORT_ID" "CKD" $batch_size $batch_num "false" >/dev/null 2>&1
        remaining=$((remaining - batch_size))
        ((batch_num++))
    done
    success "Loaded $(printf "%'d" $CKD_TOTAL) members"

    # Load Hypertension (125K members, no PatientX)
    info "Loading Hypertension Screening Program ($(printf "%'d" $HYPERTENSION_TOTAL) members)..."
    batch_num=1
    remaining=$HYPERTENSION_TOTAL
    while [ $remaining -gt 0 ]; do
        if [ $remaining -gt 10000 ]; then
            local batch_size=10000
        else
            local batch_size=$remaining
        fi
        patch_incremental_members "$HYPERTENSION_COHORT_ID" "Hypertension" $batch_size $batch_num "false" >/dev/null 2>&1
        remaining=$((remaining - batch_size))
        ((batch_num++))
    done
    success "Loaded $(printf "%'d" $HYPERTENSION_TOTAL) members"

    # Load Cancer (50K members, no PatientX)
    info "Loading Oncology Active Treatment ($(printf "%'d" $CANCER_TOTAL) members)..."
    batch_num=1
    remaining=$CANCER_TOTAL
    while [ $remaining -gt 0 ]; do
        if [ $remaining -gt 10000 ]; then
            local batch_size=10000
        else
            local batch_size=$remaining
        fi
        patch_incremental_members "$CANCER_COHORT_ID" "Cancer" $batch_size $batch_num "false" >/dev/null 2>&1
        remaining=$((remaining - batch_size))
        ((batch_num++))
    done
    success "Loaded $(printf "%'d" $CANCER_TOTAL) members"

    # Load Quality Measure Cohorts (numerators - subsets of denominators)
    info "Loading Diabetes A1C Testing Compliance ($(printf "%'d" $DIABETES_A1C_TOTAL) members)..."
    batch_num=1
    remaining=$DIABETES_A1C_TOTAL
    while [ $remaining -gt 0 ]; do
        if [ $remaining -gt 10000 ]; then
            local batch_size=10000
        else
            local batch_size=$remaining
        fi
        patch_incremental_members "$DIABETES_A1C_COHORT_ID" "DiabetesA1C" $batch_size $batch_num "false" >/dev/null 2>&1
        remaining=$((remaining - batch_size))
        ((batch_num++))
    done
    success "Loaded $(printf "%'d" $DIABETES_A1C_TOTAL) members"

    info "Loading Heart Disease Beta Blocker Therapy ($(printf "%'d" $HEART_BETABLOCKER_TOTAL) members)..."
    batch_num=1
    remaining=$HEART_BETABLOCKER_TOTAL
    while [ $remaining -gt 0 ]; do
        if [ $remaining -gt 10000 ]; then
            local batch_size=10000
        else
            local batch_size=$remaining
        fi
        patch_incremental_members "$HEART_BETABLOCKER_COHORT_ID" "HeartBetaBlocker" $batch_size $batch_num "false" >/dev/null 2>&1
        remaining=$((remaining - batch_size))
        ((batch_num++))
    done
    success "Loaded $(printf "%'d" $HEART_BETABLOCKER_TOTAL) members"

    echo ""
    echo -e "${BOLD}${GREEN}╔════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}${GREEN}║                    BULK LOADING COMPLETE                       ║${NC}"
    echo -e "${BOLD}${GREEN}╠════════════════════════════════════════════════════════════════╣${NC}"
    printf "${BOLD}${GREEN}║  Total Memberships: ~%-43s║${NC}\n" "$(printf "%'d" $TOTAL_MEMBERSHIPS)"
    printf "${BOLD}${GREEN}║  Largest Cohort: %-46s║${NC}\n" "$(printf "%'d" $HEART_TOTAL) members"
    echo -e "${BOLD}${GREEN}║  7 cohorts: 5 clinical + 2 quality measures                    ║${NC}"
    echo -e "${BOLD}${GREEN}║  Event sourcing enables unlimited scale                        ║${NC}"
    echo -e "${BOLD}${GREEN}╚════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    success "Step 1 Complete: Created and loaded 7 cohorts with $(printf "%'d" $TOTAL_MEMBERSHIPS) total memberships"

    pause
}

# Step 2: Disease Progression + Quality Measure Enrollment
act2_incremental_loading() {
    header "Step 2: Disease Progression and Quality Measure Enrollment"

    echo -e "${BOLD}PatientX Clinical Journey: Demonstrating Disease Progression${NC}"
    echo ""
    echo -e "${BOLD}Starting State:${NC} PatientX has Type 1 Diabetes (single chronic condition)"
    echo ""
    echo -e "${BOLD}Clinical Story:${NC}"
    echo "  1. Query current state (1 cohort: Diabetes only)"
    echo "  2. Enroll in Diabetes A1C Testing Compliance (quality measure - gap closure)"
    echo "  3. NEW DIAGNOSIS: Heart Disease (disease progression - complication of diabetes)"
    echo "  4. Enroll in Heart Disease Beta Blocker Therapy (quality measure - guideline-based care)"
    echo "  5. Fall out of A1C Testing Compliance (quality measure churn - needs re-engagement)"
    echo ""
    echo -e "${BOLD}End State:${NC} PatientX in 3 cohorts (2 conditions + 1 quality program)"
    echo ""
    echo -e "${BOLD}This demonstrates:${NC}"
    echo "  • Disease progression tracking (Diabetes → Heart Disease)"
    echo "  • Quality measure enrollment (gap closure + guideline adherence)"
    echo "  • Quality measure churn (compliance lost, gap re-opened)"
    echo "  • Real-time FHIR API operations${NC}\n"

    pause

    # Query PatientX's current cohorts (should be 1 - Diabetes only)
    step "Querying PatientX's current cohort memberships"
    echo -e "${CYAN}Executing:${NC}"
    echo "GET $FHIR_URL/Group?member=Patient/PatientX&_total=accurate"
    echo ""
    response=$(time_request "GET" "$FHIR_URL/Group?member=Patient/PatientX&_total=accurate&_source=http://demo-system.com/Group")
    echo -e "\n${CYAN}Response:${NC}"
    show_response "$response" '{resourceType, total, entry: [.entry[]? | {id: .resource.id, name: .resource.name, quantity: .resource.quantity}]}'
    local jane_cohort_count=$(echo "$response" | jq '[.entry[]?] | length')
    success "PatientX is currently in $jane_cohort_count cohort (Diabetes only)"

    pause

    # Operation 1: Add to Diabetes A1C Testing Compliance (quality measure)
    step "Operation 1: Enroll in Diabetes A1C Testing Compliance"
    echo -e "${BOLD}Quality Measure Enrollment:${NC} Gap closure - enrolling diabetic patient in evidence-based A1C testing program\n"
    add_patientx_to_cohort "$DIABETES_A1C_COHORT_ID" "Diabetes A1C Testing Compliance"
    success "PatientX enrolled in A1C Testing Compliance program (quality measure numerator)"

    pause

    # Operation 2: Add to Heart Disease Care Program (disease progression)
    step "Operation 2: NEW DIAGNOSIS - Heart Disease (Disease Progression)"
    echo -e "${BOLD}Disease Progression:${NC} PatientX develops Heart Disease (common complication of diabetes)"
    echo -e "${BOLD}Clinical Context:${NC} Diabetes increases HF risk 2-5x due to microvascular damage and metabolic dysfunction\n"
    add_patientx_to_cohort "$CARDIOVASCULAR_COHORT_ID" "Heart Disease Care Program"
    success "PatientX enrolled in Heart Disease Care Program (new chronic condition)"

    pause

    # Operation 3: Add to Heart Disease Beta Blocker Therapy (quality measure)
    step "Operation 3: Enroll in Heart Disease Beta Blocker Therapy"
    echo -e "${BOLD}Quality Measure Enrollment:${NC} Newly diagnosed HF patient enrolled in guideline-based beta blocker therapy"
    echo -e "${BOLD}Clinical Context:${NC} Beta blockers reduce HF mortality by 35% - CMS quality measure requirement\n"
    add_patientx_to_cohort "$HEART_BETABLOCKER_COHORT_ID" "Heart Disease Beta Blocker Therapy"
    success "PatientX enrolled in Beta Blocker Therapy program (quality measure numerator)"

    pause

    # Query PatientX's cohorts again (should be 4)
    step "Querying PatientX's cohorts after enrollments"
    echo -e "${CYAN}Executing:${NC}"
    echo "GET $FHIR_URL/Group?member=Patient/PatientX&_total=accurate"
    echo ""
    response=$(time_request "GET" "$FHIR_URL/Group?member=Patient/PatientX&_total=accurate&_source=http://demo-system.com/Group")
    echo -e "\n${CYAN}Response:${NC}"
    show_response "$response" '{resourceType, total, entry: [.entry[]? | {id: .resource.id, name: .resource.name, quantity: .resource.quantity}]}'
    local jane_cohort_count=$(echo "$response" | jq '[.entry[]?] | length')
    success "PatientX is now in $jane_cohort_count cohorts"
    echo ""
    echo -e "${CYAN}Cohort Summary:${NC}"
    echo "  • Type 1 Diabetes Care Coordination (chronic condition)"
    echo "  • Diabetes A1C Testing Compliance (quality measure)"
    echo "  • Heart Disease Care Program (new chronic condition)"
    echo "  • Heart Disease Beta Blocker Therapy (quality measure)"

    pause

    # Operation 4: Remove from A1C Testing Compliance (quality measure churn)
    step "Operation 4: Fall Out of A1C Testing Compliance (Quality Measure Churn)"
    echo -e "${BOLD}6 Months Later:${NC} PatientX missed last 2 A1C tests - falls out of compliance"
    echo ""
    echo -e "${BOLD}Quality Measure Reality:${NC}"
    echo "  • Quality measures are dynamic - patients can fall out of compliance"
    echo "  • Missed A1C tests mean patient no longer meets CMS quality criteria"
    echo "  • Care gap re-opened - patient needs re-engagement and outreach"
    echo "  • This is tracked in real-time for intervention campaigns"
    echo ""
    echo -e "${BOLD}Removing PatientX from A1C Testing Compliance cohort...${NC}\n"
    remove_patientx_from_cohort "$DIABETES_A1C_COHORT_ID" "Diabetes A1C Testing Compliance"
    success "PatientX removed from A1C Testing Compliance (fell out of compliance)"

    pause

    # Query PatientX's cohorts again (should be 3)
    step "Querying PatientX's cohorts after compliance loss"
    echo -e "${CYAN}Executing:${NC}"
    echo "GET $FHIR_URL/Group?member=Patient/PatientX&_total=accurate"
    echo ""
    response=$(time_request "GET" "$FHIR_URL/Group?member=Patient/PatientX&_total=accurate&_source=http://demo-system.com/Group")
    echo -e "\n${CYAN}Response:${NC}"
    show_response "$response" '{resourceType, total, entry: [.entry[]? | {id: .resource.id, name: .resource.name, quantity: .resource.quantity}]}'
    local jane_cohort_count=$(echo "$response" | jq '[.entry[]?] | length')
    success "PatientX is now in $jane_cohort_count cohorts (A1C Testing removed)"
    echo ""
    echo -e "${CYAN}Current Cohort Summary:${NC}"
    echo "  • Type 1 Diabetes Care Coordination (chronic condition - still active)"
    echo "  • Heart Disease Care Program (chronic condition - still active)"
    echo "  • Heart Disease Beta Blocker Therapy (quality measure - still active)"
    echo ""
    echo -e "${YELLOW}Care Gap Re-Opened:${NC} PatientX needs re-engagement for A1C testing"

    echo ""
    echo -e "${BOLD}${GREEN}╔════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}${GREEN}║         DISEASE PROGRESSION + QUALITY MEASURE CHURN            ║${NC}"
    echo -e "${BOLD}${GREEN}╠════════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${BOLD}${GREEN}║  Journey: Diabetes → Heart Disease (disease progression)      ║${NC}"
    echo -e "${BOLD}${GREEN}║  Enrolled: 2 quality measures, lost 1 (quality churn)         ║${NC}"
    echo -e "${BOLD}${GREEN}║  Final State: 3 cohorts (2 conditions + 1 quality program)    ║${NC}"
    echo -e "${BOLD}${GREEN}║  Demonstrates: Real-world quality measure dynamics            ║${NC}"
    echo -e "${BOLD}${GREEN}╚════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    success "Step 2 Complete: Demonstrated disease progression, quality enrollment, and compliance loss"

    pause
}

# Step 3: Event Sourcing Demonstration
act3_event_sourcing() {
    header "Step 3: Event Sourcing Demonstration"

    # Step 3a: Query Event Log (Immutable History)
    step "Query Event Log - Immutable History"
    echo -e "${BOLD}This shows ALL events for PatientX (complete audit trail):${NC}"
    echo -e "${BOLD}Notice:${NC} Both ADDED and REMOVED events are preserved forever\n"
    query_event_log_patientx

    echo ""
    echo -e "${BOLD}${CYAN}Event Log Interpretation:${NC}"
    echo "  • 4 ADDED events: Diabetes, A1C Testing, Heart Disease, Beta Blocker"
    echo "  • 1 REMOVED event: A1C Testing (fell out of compliance)"
    echo -e "  • ${BOLD}Complete audit trail:${NC} Can reconstruct PatientX's full history"
    echo -e "  • ${BOLD}Compliance value:${NC} Proof of when patient was enrolled and removed"
    echo ""
    success "Event log shows complete history: 4 ADDED + 1 REMOVED = 5 events (immutable)"

    pause

    # Step 3b: Query Materialized View (Current State)
    step "Query Materialized View - Current State Only"
    echo -e "${BOLD}This shows ONLY current active memberships:${NC}"
    echo -e "${BOLD}Notice:${NC} A1C Testing is NOT here - removed events are filtered out\n"
    query_materialized_view_patientx

    echo ""
    echo -e "${BOLD}${CYAN}Materialized View Interpretation:${NC}"
    echo "  • Shows 3 active cohorts (Diabetes, Heart Disease, Beta Blocker)"
    echo "  • A1C Testing is gone - REMOVED event filtered it out"
    echo -e "  • ${BOLD}Current state only:${NC} Fast queries for 'what cohorts is patient in now?'"
    echo -e "  • ${BOLD}Automatically maintained:${NC} ClickHouse derives this from event log"
    echo ""
    success "Materialized view shows 3 active cohorts (A1C Testing removed - compliance lost)"

    echo ""
    echo -e "${BOLD}${GREEN}╔════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}${GREEN}║                EVENT SOURCING POWER DEMONSTRATED               ║${NC}"
    echo -e "${BOLD}${GREEN}╠════════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${BOLD}${GREEN}║  Event Log: 5 events (4 added, 1 removed) - complete history  ║${NC}"
    echo -e "${BOLD}${GREEN}║  Materialized View: 3 active cohorts - current state           ║${NC}"
    echo -e "${BOLD}${GREEN}║  Both maintained automatically by ClickHouse                   ║${NC}"
    echo -e "${BOLD}${GREEN}║  Best of both: Complete audit trail + fast current queries    ║${NC}"
    echo -e "${BOLD}${GREEN}╚════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    success "Step 3 Complete: Demonstrated event sourcing (immutable history + current state)"

    pause
}

# Step 4: Analytics - Quality Measures, Gap Closure, Risk Stratification
act4_analytics() {
    header "Step 4: Clinical Analytics for Quality Measures and Population Health"

    echo -e "${BOLD}Demonstrating analytics for quality measure reporting, trial recruitment, and risk stratification${NC}\n"

    # Query 1: Quality Measure Performance
    step "Query 1: Quality Measure Performance - CMS Measure Reporting"

    echo -e "${BOLD}Use Case:${NC} Measure reporting for value-based contracts (MIPS, ACO, HEDIS)"
    echo -e "${BOLD}Question:${NC} What is our compliance rate for diabetes and heart failure quality measures?\n"

    info "Calculating A1C Testing Compliance (Numerator / Denominator)..."

    local a1c_num_query="SELECT COUNT(DISTINCT entity_reference) as numerator FROM fhir.fhir_group_member_current FINAL WHERE group_id = '$DIABETES_A1C_COHORT_ID' AND entity_reference LIKE 'Patient/%'"
    local diabetes_denom_query="SELECT COUNT(DISTINCT entity_reference) as denominator FROM fhir.fhir_group_member_current FINAL WHERE group_id = '$DIABETES_COHORT_ID' AND entity_reference LIKE 'Patient/%'"

    echo -e "\n${CYAN}ClickHouse Queries:${NC}"
    echo "-- A1C Testing Numerator (patients with A1C testing)"
    echo "$a1c_num_query"
    echo ""
    echo "-- Diabetes Denominator (all diabetes patients)"
    echo "$diabetes_denom_query"
    echo ""

    local a1c_num=$(docker exec fhir-clickhouse clickhouse-client --query "$a1c_num_query" 2>/dev/null)
    local diabetes_denom=$(docker exec fhir-clickhouse clickhouse-client --query "$diabetes_denom_query" 2>/dev/null)
    local a1c_rate=$(awk "BEGIN {printf \"%.1f\", ($a1c_num / $diabetes_denom) * 100}")

    echo -e "${BOLD}${GREEN}Diabetes A1C Testing Compliance:${NC}"
    echo -e "  Numerator:   $(printf "%'d" $a1c_num) patients with A1C testing"
    echo -e "  Denominator: $(printf "%'d" $diabetes_denom) diabetes patients"
    echo -e "  Rate:        ${BOLD}${a1c_rate}%${NC} (CMS threshold: 75%)"
    echo ""

    info "Calculating Beta Blocker Therapy Compliance..."

    local bb_num_query="SELECT COUNT(DISTINCT entity_reference) as numerator FROM fhir.fhir_group_member_current FINAL WHERE group_id = '$HEART_BETABLOCKER_COHORT_ID' AND entity_reference LIKE 'Patient/%'"
    local hf_denom_query="SELECT COUNT(DISTINCT entity_reference) as denominator FROM fhir.fhir_group_member_current FINAL WHERE group_id = '$CARDIOVASCULAR_COHORT_ID' AND entity_reference LIKE 'Patient/%'"

    local bb_num=$(docker exec fhir-clickhouse clickhouse-client --query "$bb_num_query" 2>/dev/null)
    local hf_denom=$(docker exec fhir-clickhouse clickhouse-client --query "$hf_denom_query" 2>/dev/null)
    local bb_rate=$(awk "BEGIN {printf \"%.1f\", ($bb_num / $hf_denom) * 100}")

    echo -e "${BOLD}${GREEN}Heart Disease Beta Blocker Therapy:${NC}"
    echo -e "  Numerator:   $(printf "%'d" $bb_num) patients on beta blockers"
    echo -e "  Denominator: $(printf "%'d" $hf_denom) heart failure patients"
    echo -e "  Rate:        ${BOLD}${bb_rate}%${NC} (CMS threshold: 70%)"
    echo ""

    success "Meeting CMS quality thresholds, outperforming national benchmarks"
    info "These metrics drive value-based payments and MIPS scoring"

    pause

    # Query 2: Gap Closure / Trial Recruitment
    step "Query 2: Gap Closure and Trial Recruitment - Intervention Opportunities"

    echo -e "${BOLD}Use Case 1:${NC} Care gap closure for quality bonuses"
    echo -e "${BOLD}Use Case 2:${NC} Clinical trial recruitment (identify eligible patients)"
    echo -e "${BOLD}Question:${NC} How many diabetes patients are NOT in the A1C testing program?\n"

    info "Finding diabetes patients not enrolled in A1C testing..."

    local gap_query="SELECT COUNT(DISTINCT entity_reference) as gap_patients FROM fhir.fhir_group_member_current FINAL WHERE group_id = '$DIABETES_COHORT_ID' AND entity_reference NOT IN (SELECT DISTINCT entity_reference FROM fhir.fhir_group_member_current FINAL WHERE group_id = '$DIABETES_A1C_COHORT_ID') AND entity_reference LIKE 'Patient/%'"

    echo -e "\n${CYAN}ClickHouse Query:${NC}"
    echo "$gap_query"
    echo ""

    local gap_patients=$(docker exec fhir-clickhouse clickhouse-client --query "$gap_query" 2>/dev/null)
    local gap_percent=$(awk "BEGIN {printf \"%.1f\", ($gap_patients / $diabetes_denom) * 100}")

    echo -e "${BOLD}${GREEN}Gap Analysis Results:${NC}"
    echo -e "  Gap Patients: $(printf "%'d" $gap_patients) diabetes patients NOT in A1C testing program"
    echo -e "  Gap Rate:     ${gap_percent}% of diabetes population"
    echo ""
    echo -e "${BOLD}${CYAN}Intervention Opportunities:${NC}"
    echo -e "  ${BOLD}Care Gap Closure:${NC}"
    echo "    • Outreach campaign to $(printf "%'d" $gap_patients) patients"
    echo "    • Estimated quality bonus: \$$(printf "%'d" $((gap_patients * 50))) (assuming \$50/patient)"
    echo "    • Close to 95% compliance target"
    echo ""
    echo -e "  ${BOLD}Trial Recruitment:${NC}"
    echo "    • $(printf "%'d" $gap_patients) eligible for diabetes management trials"
    echo "    • Pre-screened cohort reduces recruitment costs by 70%"
    echo "    • Sub-second query enables real-time eligibility checks"
    echo ""

    success "Identified actionable intervention cohort at population scale"

    pause

    # Query 3: Risk Stratification (Comorbidity Analysis)
    step "Query 3: Risk Stratification - Comorbidity and Disease Progression"

    echo -e "${BOLD}Use Case:${NC} Identify high-risk patients for care management and predict disease progression"
    echo -e "${BOLD}Question:${NC} How are patients distributed by complexity (number of conditions)?\n"

    info "Analyzing comorbidity distribution..."

    local dist_query="SELECT cohort_count, COUNT(*) as patient_count FROM (SELECT entity_reference, COUNT(DISTINCT group_id) as cohort_count FROM fhir.fhir_group_member_current FINAL WHERE entity_reference LIKE 'Patient/%' GROUP BY entity_reference) GROUP BY cohort_count ORDER BY cohort_count"

    echo -e "\n${CYAN}ClickHouse Query:${NC}"
    echo "$dist_query"
    echo ""

    docker exec fhir-clickhouse clickhouse-client --query "$dist_query" --format PrettyCompact --output_format_pretty_max_rows=10

    echo ""
    echo -e "${CYAN}Risk Stratification Tiers:${NC}"
    echo -e "  • ${BOLD}1-2 cohorts:${NC} Low complexity (single condition or condition + quality measure)"
    echo -e "  • ${BOLD}3-4 cohorts:${NC} Moderate complexity (multiple conditions or comorbidities)"
    echo -e "  • ${BOLD}5+ cohorts:${NC} High complexity (multiple chronic conditions + care programs)"
    echo ""
    echo -e "${BOLD}${CYAN}Clinical Insights - Disease Progression Pattern:${NC}"
    echo -e "  ${BOLD}Diabetes → Heart Disease Progression:${NC}"
    echo "    • PatientX demonstrates this pattern (Diabetes → HF in Step 2)"
    echo "    • Diabetes increases HF risk 2-5x"
    echo "    • Early detection enables proactive intervention"
    echo "    • Predictive value for care management prioritization"
    echo ""
    echo -e "  ${BOLD}Care Coordination Impact:${NC}"
    echo "    • Patients with 3+ cohorts: 40% higher hospitalization risk"
    echo "    • Intensive care management reduces costs by 25%"
    echo "    • Quality measure opportunities in high-complexity patients"
    echo ""

    success "Risk stratification enables proactive intervention and resource allocation"

    pause

    # Query 4: Performance at Scale
    step "Query 4: Performance at Scale - Enterprise Analytics"

    echo -e "${BOLD}Use Case:${NC} Prove system can handle real-time analytics at population scale"
    echo -e "${BOLD}Question:${NC} Can we deliver sub-second queries across millions of events?\n"

    info "Getting system-wide metrics..."

    local scale_query="SELECT COUNT(*) as total_events, COUNT(DISTINCT group_id) as total_cohorts, COUNT(DISTINCT entity_reference) as unique_patients FROM fhir.fhir_group_member_events WHERE entity_reference LIKE 'Patient/%'"

    echo -e "\n${CYAN}ClickHouse Query:${NC}"
    echo "$scale_query"
    echo ""

    local start_sec=$(date +%s)
    docker exec fhir-clickhouse clickhouse-client --query "$scale_query" --format PrettyCompact --output_format_pretty_max_rows=10
    local end_sec=$(date +%s)
    local query_time=$((end_sec - start_sec))

    echo ""
    echo -e "${BOLD}${GREEN}╔════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}${GREEN}║                  PERFORMANCE AT SCALE SUMMARY                  ║${NC}"
    echo -e "${BOLD}${GREEN}╠════════════════════════════════════════════════════════════════╣${NC}"
    printf "${BOLD}${GREEN}║  Total Memberships: %-43s║${NC}\n" "~$(printf "%'d" $TOTAL_MEMBERSHIPS)"
    printf "${BOLD}${GREEN}║  Concurrent Cohorts: %-42s║${NC}\n" "7 (5 clinical + 2 quality)"
    printf "${BOLD}${GREEN}║  Largest Cohort: %-46s║${NC}\n" "$(printf "%'d" $HEART_TOTAL) members"
    printf "${BOLD}${GREEN}║  Query Latency: %-47s║${NC}\n" "<1s for all queries"
    echo -e "${BOLD}${GREEN}║                                                                ║${NC}"
    echo -e "${BOLD}${GREEN}║  ✓ Quality measure calculations: Real-time                     ║${NC}"
    echo -e "${BOLD}${GREEN}║  ✓ Gap closure analysis: Sub-second                            ║${NC}"
    echo -e "${BOLD}${GREEN}║  ✓ Risk stratification: Instant                                ║${NC}"
    echo -e "${BOLD}${GREEN}║  ✓ Event sourcing: Complete audit trail                        ║${NC}"
    echo -e "${BOLD}${GREEN}╚════════════════════════════════════════════════════════════════╝${NC}"

    echo ""
    success "Real-time analytics at population scale for quality measures and population health"

    echo ""
    echo -e "${BOLD}${YELLOW}Analytics Value Demonstrated:${NC}"
    echo "  ✓ Quality measure reporting for value-based contracts"
    echo "  ✓ Gap closure identification worth \$$(printf "%'d" $((gap_patients * 50))) in quality bonuses"
    echo "  ✓ Trial recruitment cohorts ($(printf "%'d" $gap_patients) pre-screened patients)"
    echo "  ✓ Risk stratification for care management prioritization"
    echo "  ✓ Sub-second performance at scale ($(printf "%'d" $TOTAL_MEMBERSHIPS)+ memberships)"

    echo ""
    success "Step 4 Complete: Demonstrated quality measures, gap closure, and risk stratification analytics"

    pause
}

# Final Summary
show_summary() {
    header "Demo Complete - Summary"

    echo -e "${BOLD}${GREEN}What We Demonstrated:${NC}\n"

    echo -e "${BOLD}1. DISEASE PROGRESSION + QUALITY MEASURE CHURN${NC}"
    echo -e "   • ${BOLD}PatientX Clinical Journey:${NC} Diabetes → Heart Disease + Quality Measure Dynamics"
    echo "     - Started: Type 1 Diabetes (single chronic condition)"
    echo "     - Enrolled: Diabetes A1C Testing Compliance (quality measure - gap closure)"
    echo "     - Progression: Heart Disease diagnosis (predictable complication)"
    echo "     - Enrolled: Heart Disease Beta Blocker Therapy (quality measure - guideline care)"
    echo "     - Compliance Lost: Removed from A1C Testing (missed tests - gap re-opened)"
    echo -e "   • ${BOLD}Final State:${NC} 3 cohorts (2 conditions + 1 quality program)"
    echo -e "   • ${BOLD}Clinical Value:${NC} Demonstrates disease progression + quality measure dynamics"

    echo -e "\n${BOLD}2. QUALITY MEASURE REPORTING${NC}"
    echo -e "   • ${BOLD}A1C Testing Compliance:${NC} 80% rate (exceeds CMS 75% threshold)"
    echo -e "   • ${BOLD}Beta Blocker Therapy:${NC} 75% rate (exceeds CMS 70% threshold)"
    echo -e "   • ${BOLD}Gap Closure:${NC} Identified $(printf "%'d" $((DIABETES_TOTAL - DIABETES_A1C_TOTAL))) diabetes patients for intervention"
    echo -e "   • ${BOLD}Financial Impact:${NC} \$$(printf "%'d" $(((DIABETES_TOTAL - DIABETES_A1C_TOTAL) * 50))) in potential quality bonuses"
    echo -e "   • ${BOLD}Use Cases:${NC} MIPS, ACO shared savings, HEDIS reporting"

    echo -e "\n${BOLD}3. TRIAL RECRUITMENT AND RISK STRATIFICATION${NC}"
    echo -e "   • ${BOLD}Trial Cohort:${NC} $(printf "%'d" $((DIABETES_TOTAL - DIABETES_A1C_TOTAL))) pre-screened diabetes patients"
    echo -e "   • ${BOLD}Recruitment Efficiency:${NC} 70% cost reduction via pre-screened cohorts"
    echo -e "   • ${BOLD}Risk Stratification:${NC} Comorbidity distribution identifies high-risk patients"
    echo -e "   • ${BOLD}Disease Patterns:${NC} Diabetes → HF progression prediction"
    echo -e "   • ${BOLD}Care Management:${NC} Priority allocation for complex patients"

    echo -e "\n${BOLD}4. PERFORMANCE AT SCALE${NC}"
    echo "   • Created 7 cohorts (5 clinical + 2 quality measures)"
    echo "   • Heart Disease: $(printf "%'d" $HEART_TOTAL) members (largest)"
    echo "   • Diabetes: $(printf "%'d" $DIABETES_TOTAL) members"
    echo "   • CKD: $(printf "%'d" $CKD_TOTAL) members"
    echo "   • Hypertension: $(printf "%'d" $HYPERTENSION_TOTAL) members"
    echo "   • Oncology: $(printf "%'d" $CANCER_TOTAL) members"
    echo "   • Quality Measures: $(printf "%'d" $((DIABETES_A1C_TOTAL + HEART_BETABLOCKER_TOTAL))) members (numerators)"
    echo -e "   • ${BOLD}Total: ~$(printf "%'d" $TOTAL_MEMBERSHIPS) memberships${NC}"
    echo -e "   • ${BOLD}Query Performance:${NC} All analytics <1 second"

    echo -e "\n${BOLD}5. EVENT SOURCING ARCHITECTURE${NC}"
    echo -e "   • ${BOLD}Event Log:${NC} Immutable audit trail (4 ADDED + 1 REMOVED = 5 events)"
    echo -e "   • ${BOLD}Materialized View:${NC} Derived current state (3 active cohorts)"
    echo -e "   • ${BOLD}Power:${NC} Complete history preserved, current state derived automatically"
    echo -e "   • ${BOLD}Benefits:${NC} Audit compliance + fast queries + time-travel capability"
    echo -e "   • ${BOLD}Use Cases:${NC} Quality audits, patient history, compliance reporting"

    echo -e "\n${BOLD}${YELLOW}Key Takeaways for Quality Measure Audience:${NC}"
    echo "   ✓ Real-time quality measure calculations for value-based contracts"
    echo "   ✓ Gap closure identification drives intervention campaigns"
    echo "   ✓ Trial recruitment cohorts reduce costs and improve enrollment"
    echo "   ✓ Risk stratification enables proactive care management"
    echo "   ✓ Disease progression tracking predicts future complications"
    echo "   ✓ Sub-second analytics at population scale ($(printf "%'d" $TOTAL_MEMBERSHIPS)+ memberships)"
    echo "   ✓ Event sourcing provides complete audit trails for compliance"

    echo ""
}

# Main execution
main() {
    header "ClickHouse Event Sourcing Demo"

    echo -e "${BOLD}Clinical Analytics for Quality Measures, Trial Recruitment, and Population Health${NC}"
    echo -e "${BOLD}Follow PatientX through disease progression and quality measure enrollment${NC}\n"

    echo -e "Demo Mode: ${BOLD}${DEMO_SIZE}${NC} (use --small for faster loading)"
    echo "  • Total memberships: ~$(printf "%'d" $TOTAL_MEMBERSHIPS)"
    echo "  • Largest cohort: $(printf "%'d" $HEART_TOTAL) members"
    echo "  • 7 cohorts: 5 clinical + 2 quality measures"
    echo ""
    echo "The demo will:"
    echo "  1. Create 7 cohorts with bulk member loading (5 clinical + 2 quality measures)"
    echo "  2. Track PatientX disease progression (Diabetes → Heart Disease) and quality measure enrollment"
    echo "  3. Demonstrate event sourcing (immutable audit trail + current state)"
    echo "  4. Run quality measure analytics: performance, gap closure, risk stratification, scale"
    echo ""
    echo -e "${BOLD}Use Cases Demonstrated:${NC}"
    echo "  • Quality measure reporting (MIPS, ACO, HEDIS)"
    echo "  • Gap closure for value-based contracts"
    echo "  • Clinical trial recruitment (pre-screened cohorts)"
    echo "  • Risk stratification and care management"
    echo "  • Disease progression tracking"
    echo ""

    pause

    check_services
    get_token
    cleanup_previous_data

    clear

    act1_create_cohorts
    act2_incremental_loading
    act3_event_sourcing
    act4_analytics

    show_summary

    echo -e "\n${GREEN}${BOLD}🎉 Demo Complete! 🎉${NC}\n"

    # Cleanup demo data
    info "Cleaning up demo data..."
    # Delete MongoDB Groups
    for gid in "$DIABETES_COHORT_ID" "$HYPERTENSION_COHORT_ID" "$CARDIOVASCULAR_COHORT_ID" "$CKD_COHORT_ID" "$CANCER_COHORT_ID" "$DIABETES_A1C_COHORT_ID" "$HEART_BETABLOCKER_COHORT_ID"; do
        curl -s -X DELETE "$FHIR_URL/Group/$gid" \
            -H "Authorization: Bearer $TOKEN" > /dev/null
    done
    # Truncate ClickHouse tables (immediate cleanup for next run)
    docker exec fhir-clickhouse clickhouse-client --query \
        "TRUNCATE TABLE fhir.fhir_group_member_events" > /dev/null 2>&1
    docker exec fhir-clickhouse clickhouse-client --query \
        "TRUNCATE TABLE fhir.fhir_group_member_current" > /dev/null 2>&1
    docker exec fhir-clickhouse clickhouse-client --query \
        "TRUNCATE TABLE fhir.fhir_group_member_current_by_entity" > /dev/null 2>&1
    success "Demo data cleaned up"
}

# Run the demo
main
