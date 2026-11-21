import { describe, expect, it } from 'vitest';
import { ApiError, NETWORK_TROUBLE, SERVER_TROUBLE } from '../../../api/request';
import { NETWORK_FAILED, SERVER_FAILED, uploadFailure } from './useUploads';

// 上传失败分三种说（12 页 S02）
describe('uploadFailure', () => {
  it('断网、超时（没有状态码）：网络可能断了，能重试', () => {
    expect(uploadFailure(new ApiError(0, NETWORK_TROUBLE))).toEqual({ kind: 'failed', message: NETWORK_FAILED });
    expect(uploadFailure(new TypeError('Failed to fetch'))).toEqual({ kind: 'failed', message: NETWORK_FAILED });
  });

  it('服务器 5xx：说是耕云服务的问题，能重试', () => {
    expect(uploadFailure(new ApiError(500, SERVER_TROUBLE))).toEqual({ kind: 'failed', message: SERVER_FAILED });
    expect(uploadFailure(new ApiError(503, SERVER_TROUBLE))).toEqual({ kind: 'failed', message: SERVER_FAILED });
    expect(SERVER_FAILED).toBe('没传上去，耕云服务暂时出了问题，请稍后再试。');
  });

  it('4xx：照旧显示服务器给的中文原因，只能移除', () => {
    const msg = '压缩包打不开。请解压后把里面的文件传上来。';
    expect(uploadFailure(new ApiError(400, msg))).toEqual({ kind: 'rejected', message: msg });
    expect(uploadFailure(new ApiError(409, '有人同时在传'))).toEqual({ kind: 'rejected', message: '有人同时在传' });
  });
});
