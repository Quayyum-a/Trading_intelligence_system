import type { SupabaseClient } from '@supabase/supabase-js';
import type { StrategyAuditRecord } from '../strategy/strategy.types.js';
import { getSupabaseClient } from '../config/supabase.js';

export class StrategyAuditRepository {
  private supabase: SupabaseClient;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || getSupabaseClient();
  }

  /**
   * Store audit log entry in database
   */
  async create(
    strategyDecisionId: string,
    stage: 'REGIME' | 'SETUP' | 'QUALIFICATION' | 'RISK' | 'RR' | 'CONFIDENCE' | 'TIME',
    status: 'PASSED' | 'FAILED',
    details: object
  ): Promise<StrategyAuditRecord> {
    try {
      const record: Omit<StrategyAuditRecord, 'id' | 'createdAt'> = {
        strategyDecisionId,
        stage,
        status,
        details
      };

      const { data, error } = await this.supabase
        .from('strategy_audit_log')
        .insert(record)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to create audit log entry: ${error.message}`);
      }

      return {
        ...data,
        createdAt: new Date(data.created_at)
      };

    } catch (error) {
      throw new Error(`Audit log creation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get audit logs by strategy decision ID
   */
  async getByStrategyDecisionId(strategyDecisionId: string): Promise<StrategyAuditRecord[]> {
    try {
      const { data, error } = await this.supabase
        .from('strategy_audit_log')
        .select('*')
        .eq('strategy_decision_id', strategyDecisionId)
        .order('created_at', { ascending: true });

      if (error) {
        throw new Error(`Failed to get audit logs by decision: ${error.message}`);
      }

      return data.map(record => ({
        ...record,
        createdAt: new Date(record.created_at)
      }));

    } catch (error) {
      throw new Error(`Failed to retrieve audit logs by decision: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get audit logs by decision ID (alias for monitoring service)
   */
  async getAuditLogsByDecisionId(strategyDecisionId: string): Promise<StrategyAuditRecord[]> {
    return this.getByStrategyDecisionId(strategyDecisionId);
  }

  /**
   * Get audit logs by stage
   */
  async getByStage(
    stage: 'REGIME' | 'SETUP' | 'QUALIFICATION' | 'RISK' | 'RR' | 'CONFIDENCE' | 'TIME',
    limit: number = 100
  ): Promise<StrategyAuditRecord[]> {
    try {
      const { data, error } = await this.supabase
        .from('strategy_audit_log')
        .select('*')
        .eq('stage', stage)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        throw new Error(`Failed to get audit logs by stage: ${error.message}`);
      }

      return data.map(record => ({
        ...record,
        createdAt: new Date(record.created_at)
      }));

    } catch (error) {
      throw new Error(`Failed to retrieve audit logs by stage: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get audit logs by status
   */
  async getByStatus(
    status: 'PASSED' | 'FAILED',
    limit: number = 100
  ): Promise<StrategyAuditRecord[]> {
    try {
      const { data, error } = await this.supabase
        .from('strategy_audit_log')
        .select('*')
        .eq('status', status)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        throw new Error(`Failed to get audit logs by status: ${error.message}`);
      }

      return data.map(record => ({
        ...record,
        createdAt: new Date(record.created_at)
      }));

    } catch (error) {
      throw new Error(`Failed to retrieve audit logs by status: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get audit logs by time range
   */
  async getByTimeRange(
    startTime: Date,
    endTime: Date,
    stage?: string,
    status?: string
  ): Promise<StrategyAuditRecord[]> {
    try {
      let query = this.supabase
        .from('strategy_audit_log')
        .select('*')
        .gte('created_at', startTime.toISOString())
        .lte('created_at', endTime.toISOString());

      if (stage) {
        query = query.eq('stage', stage);
      }

      if (status) {
        query = query.eq('status', status);
      }

      const { data, error } = await query.order('created_at', { ascending: true });

      if (error) {
        throw new Error(`Failed to get audit logs by time range: ${error.message}`);
      }

      return data.map(record => ({
        ...record,
        createdAt: new Date(record.created_at)
      }));

    } catch (error) {
      throw new Error(`Failed to retrieve audit logs by time range: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get recent audit logs
   */
  async getRecent(limit: number = 100): Promise<StrategyAuditRecord[]> {
    try {
      const { data, error } = await this.supabase
        .from('strategy_audit_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        throw new Error(`Failed to get recent audit logs: ${error.message}`);
      }

      return data.map(record => ({
        ...record,
        createdAt: new Date(record.created_at)
      }));

    } catch (error) {
      throw new Error(`Failed to retrieve recent audit logs: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Count audit logs by stage and status
   */
  async countByStageAndStatus(
    startTime: Date,
    endTime: Date
  ): Promise<{ [stage: string]: { PASSED: number; FAILED: number } }> {
    try {
      const { data, error } = await this.supabase
        .from('strategy_audit_log')
        .select('stage, status')
        .gte('created_at', startTime.toISOString())
        .lte('created_at', endTime.toISOString());

      if (error) {
        throw new Error(`Failed to count audit logs: ${error.message}`);
      }

      const counts: { [stage: string]: { PASSED: number; FAILED: number } } = {};
      
      data.forEach(record => {
        if (!counts[record.stage]) {
          counts[record.stage] = { PASSED: 0, FAILED: 0 };
        }
        counts[record.stage][record.status as 'PASSED' | 'FAILED']++;
      });

      return counts;

    } catch (error) {
      throw new Error(`Failed to count audit logs: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get failed audit logs with details
   */
  async getFailedLogs(
    limit: number = 50,
    stage?: string
  ): Promise<StrategyAuditRecord[]> {
    try {
      let query = this.supabase
        .from('strategy_audit_log')
        .select('*')
        .eq('status', 'FAILED');

      if (stage) {
        query = query.eq('stage', stage);
      }

      const { data, error } = await query
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        throw new Error(`Failed to get failed audit logs: ${error.message}`);
      }

      return data.map(record => ({
        ...record,
        createdAt: new Date(record.created_at)
      }));

    } catch (error) {
      throw new Error(`Failed to retrieve failed audit logs: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get audit trail for specific decision
   */
  async getAuditTrail(strategyDecisionId: string): Promise<{
    decisionId: string;
    stages: Array<{
      stage: string;
      status: string;
      timestamp: Date;
      details: object;
    }>;
    summary: {
      totalStages: number;
      passedStages: number;
      failedStages: number;
      overallStatus: 'PASSED' | 'FAILED';
    };
  }> {
    try {
      const auditLogs = await this.getByStrategyDecisionId(strategyDecisionId);
      
      const stages = auditLogs.map(log => ({
        stage: log.stage,
        status: log.status,
        timestamp: log.createdAt,
        details: log.details
      }));

      const summary = {
        totalStages: auditLogs.length,
        passedStages: auditLogs.filter(log => log.status === 'PASSED').length,
        failedStages: auditLogs.filter(log => log.status === 'FAILED').length,
        overallStatus: auditLogs.every(log => log.status === 'PASSED') ? 'PASSED' as const : 'FAILED' as const
      };

      return {
        decisionId: strategyDecisionId,
        stages,
        summary
      };

    } catch (error) {
      throw new Error(`Failed to get audit trail: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Delete old audit logs (cleanup)
   */
  async deleteOlderThan(days: number): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      const { data, error } = await this.supabase
        .from('strategy_audit_log')
        .delete()
        .lt('created_at', cutoffDate.toISOString())
        .select('id');

      if (error) {
        throw new Error(`Failed to delete old audit logs: ${error.message}`);
      }

      return data?.length || 0;

    } catch (error) {
      throw new Error(`Failed to cleanup old audit logs: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Log multiple stages for a decision (batch operation)
   */
  async logMultipleStages(
    strategyDecisionId: string,
    stages: Array<{
      stage: 'REGIME' | 'SETUP' | 'QUALIFICATION' | 'RISK' | 'RR' | 'CONFIDENCE' | 'TIME';
      status: 'PASSED' | 'FAILED';
      details: object;
    }>
  ): Promise<StrategyAuditRecord[]> {
    try {
      const records = stages.map(stage => ({
        strategy_decision_id: strategyDecisionId,
        stage: stage.stage,
        status: stage.status,
        details: stage.details
      }));

      const { data, error } = await this.supabase
        .from('strategy_audit_log')
        .insert(records)
        .select();

      if (error) {
        throw new Error(`Failed to create multiple audit log entries: ${error.message}`);
      }

      return data.map(record => ({
        ...record,
        createdAt: new Date(record.created_at)
      }));

    } catch (error) {
      throw new Error(`Batch audit log creation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get audit statistics
   */
  async getAuditStats(
    startTime: Date,
    endTime: Date
  ): Promise<{
    totalLogs: number;
    passedLogs: number;
    failedLogs: number;
    stageStats: { [stage: string]: { passed: number; failed: number; total: number } };
    passRate: number;
  }> {
    try {
      const logs = await this.getByTimeRange(startTime, endTime);
      
      const stats = {
        totalLogs: logs.length,
        passedLogs: logs.filter(log => log.status === 'PASSED').length,
        failedLogs: logs.filter(log => log.status === 'FAILED').length,
        stageStats: {} as { [stage: string]: { passed: number; failed: number; total: number } },
        passRate: 0
      };

      // Calculate stage statistics
      logs.forEach(log => {
        if (!stats.stageStats[log.stage]) {
          stats.stageStats[log.stage] = { passed: 0, failed: 0, total: 0 };
        }
        
        stats.stageStats[log.stage].total++;
        if (log.status === 'PASSED') {
          stats.stageStats[log.stage].passed++;
        } else {
          stats.stageStats[log.stage].failed++;
        }
      });

      // Calculate overall pass rate
      if (stats.totalLogs > 0) {
        stats.passRate = stats.passedLogs / stats.totalLogs;
      }

      return stats;

    } catch (error) {
      throw new Error(`Failed to calculate audit statistics: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}