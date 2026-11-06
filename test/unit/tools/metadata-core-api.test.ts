/**
 * The metadata tools are unit-tested against a mocked core. This checks the REAL core still exports what they call,
 * so an API change in a core release fails here rather than at a user's first call.
 */
import { describe, expect, it } from '@jest/globals'
import * as core from '@sonisoft/now-sdk-ext-core'

const methods: Record<string, string[]> = {
  MetadataFormWriter: ['insert', 'update', 'delete'],
  ColumnWriter: ['addColumn', 'removeColumn'],
  ChoiceWriter: ['getChoices', 'setChoice', 'removeChoice'],
  FormLayoutWriter: ['getFormLayout', 'setFormLayout'],
  ListLayoutWriter: ['getListLayout', 'setListLayout'],
}

describe('core exports used by the metadata tools', () => {
  it.each(Object.entries(methods))('%s has its methods', (name, names) => {
    const cls = (core as Record<string, any>)[name]
    expect(typeof cls).toBe('function')
    for (const method of names) expect(typeof cls.prototype[method]).toBe('function')
  })

  it('exports the error classes and the refusal check', () => {
    expect(typeof (core as any).MetadataScopeError).toBe('function')
    expect(typeof (core as any).MetadataVerificationError).toBe('function')
    expect(typeof (core as any).isPolicyRefusal).toBe('function')
    expect(typeof (core as any).redactMessage).toBe('function')
  })
})

describe('the real redactor after markup is stripped', () => {
  it('redacts a secret that markup had split', () => {
    const stripped = 'password<b>: </b>hunter2'.replace(/<[^>]*>/g, '').replace(/[<>]/g, '')
    expect((core as any).redactMessage(stripped)).not.toContain('hunter2')
  })
})
