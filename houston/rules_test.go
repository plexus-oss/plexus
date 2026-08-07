package main

import (
	"encoding/json"
	"testing"
)

func TestRuleStore_ReplaceOrgAndLookup(t *testing.T) {
	var lastChanged string
	store := NewRuleStore(func(orgID string) { lastChanged = orgID })

	rules := []AlertRule{
		{ID: "r1", OrgID: "org1", SourceID: "drone-1", Type: RuleThreshold, Metric: "temp", Severity: "warning"},
		{ID: "r2", OrgID: "org1", SourceID: "drone-2", Type: RuleOutlier, Metric: "pressure", Severity: "critical"},
	}

	store.ReplaceOrg("org1", rules)

	if lastChanged != "org1" {
		t.Errorf("onChange called with %q, want %q", lastChanged, "org1")
	}

	got := store.RulesForOrg("org1")
	if len(got) != 2 {
		t.Fatalf("RulesForOrg = %d rules, want 2", len(got))
	}

	// Lookup by source
	drone1Rules := store.RulesForOrgSource("org1", "drone-1")
	if len(drone1Rules) != 1 || drone1Rules[0].ID != "r1" {
		t.Errorf("RulesForOrgSource(drone-1) = %v, want [r1]", drone1Rules)
	}

	// Unknown org
	if store.RulesForOrg("org2") != nil {
		t.Error("RulesForOrg(org2) should return nil")
	}
}

func TestRuleStore_ReplaceOrgClear(t *testing.T) {
	store := NewRuleStore(nil)
	store.ReplaceOrg("org1", []AlertRule{{ID: "r1"}})
	store.ReplaceOrg("org1", nil) // clear

	if store.RulesForOrg("org1") != nil {
		t.Error("rules should be cleared")
	}

	orgs := store.OrgsWithRules()
	if len(orgs) != 0 {
		t.Errorf("OrgsWithRules = %v, want empty", orgs)
	}
}

func TestRuleStore_ReplaceAll(t *testing.T) {
	store := NewRuleStore(nil)
	store.ReplaceOrg("org1", []AlertRule{{ID: "r1"}})

	store.ReplaceAll(map[string][]AlertRule{
		"org2": {{ID: "r2"}},
		"org3": {{ID: "r3"}},
	})

	if store.RulesForOrg("org1") != nil {
		t.Error("org1 rules should be gone after ReplaceAll")
	}

	orgs := store.OrgsWithRules()
	if len(orgs) != 2 {
		t.Errorf("OrgsWithRules = %d, want 2", len(orgs))
	}
}

func TestRuleStore_OrgsWithRules(t *testing.T) {
	store := NewRuleStore(nil)
	store.ReplaceOrg("org1", []AlertRule{{ID: "r1"}})
	store.ReplaceOrg("org2", []AlertRule{{ID: "r2"}, {ID: "r3"}})

	orgs := store.OrgsWithRules()
	if len(orgs) != 2 {
		t.Errorf("OrgsWithRules = %d, want 2", len(orgs))
	}
}

func TestAlertRule_JSONRoundTrip(t *testing.T) {
	min := 20.0
	max := 80.0
	zscore := 3.0
	minSamples := 30

	tests := []struct {
		name string
		rule AlertRule
	}{
		{
			name: "threshold",
			rule: AlertRule{
				ID: "r1", OrgID: "org1", SourceID: "drone-1",
				Type: RuleThreshold, Metric: "temperature",
				Conditions:        RuleConditions{Min: &min, Max: &max},
				HysteresisSeconds: 30, CooldownSeconds: 60,
				Severity: "warning",
			},
		},
		{
			name: "outlier",
			rule: AlertRule{
				ID: "r2", OrgID: "org1", SourceID: "drone-1",
				Type: RuleOutlier, Metric: "temperature",
				Conditions:        RuleConditions{ZScore: &zscore, MinSamples: &minSamples},
				HysteresisSeconds: 30, CooldownSeconds: 60,
				Severity: "warning",
			},
		},
		{
			name: "compound",
			rule: AlertRule{
				ID: "r3", OrgID: "org1", SourceID: "drone-1",
				Type: RuleCompound, Operator: "and",
				SubRules: []SubRule{
					{Type: RuleThreshold, Metric: "temperature", Conditions: RuleConditions{Max: &max}},
					{Type: RuleOutlier, Metric: "pressure", Conditions: RuleConditions{ZScore: &zscore, MinSamples: &minSamples}},
				},
				HysteresisSeconds: 30, CooldownSeconds: 60,
				Severity: "critical",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, err := json.Marshal(tt.rule)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}

			var got AlertRule
			if err := json.Unmarshal(data, &got); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}

			if got.ID != tt.rule.ID {
				t.Errorf("ID = %q, want %q", got.ID, tt.rule.ID)
			}
			if got.Type != tt.rule.Type {
				t.Errorf("Type = %q, want %q", got.Type, tt.rule.Type)
			}
			if got.Severity != tt.rule.Severity {
				t.Errorf("Severity = %q, want %q", got.Severity, tt.rule.Severity)
			}
			if len(got.SubRules) != len(tt.rule.SubRules) {
				t.Errorf("SubRules len = %d, want %d", len(got.SubRules), len(tt.rule.SubRules))
			}
		})
	}
}
