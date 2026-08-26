import { useEffect, useState, type ReactNode } from 'react';
import { Button, Result, Spin } from 'antd';
import { useNavigate } from 'react-router-dom';
import { getAgentAccess } from '../api/client';

interface AgentAccessGateProps {
  children: ReactNode;
}

type GateState = 'checking' | 'ready' | 'blocked';

export function AgentAccessGate({ children }: AgentAccessGateProps) {
  const navigate = useNavigate();
  const [state, setState] = useState<GateState>('checking');

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const access = await getAgentAccess();
        if (mounted) {
          setState(access.allowed ? 'ready' : 'blocked');
        }
      } catch {
        if (mounted) {
          setState('blocked');
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  if (state === 'checking') {
    return (
      <div style={{ minHeight: 320, display: 'grid', placeItems: 'center' }}>
        <Spin description="正在检查 Agent 配置…" />
      </div>
    );
  }

  if (state === 'blocked') {
    return (
      <Result
        status="403"
        title="Agent 工作台尚未激活"
        subTitle="请先在设置页保存 Agent API Key；已有历史会话时也可以进入查看。"
        extra={
          <Button type="primary" onClick={() => navigate('/settings')}>
            去设置
          </Button>
        }
      />
    );
  }

  return children;
}
