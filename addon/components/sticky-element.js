import { attributeBindings, classNames, layout as templateLayout } from '@ember-decorators/component';
import { action, computed } from '@ember/object';
import { notEmpty, or } from '@ember/object/computed';
import { htmlSafe } from '@ember/template';
import Component from '@ember/component';
import { later, cancel, debounce } from '@ember/runloop';
import layout from '../templates/components/sticky-element';

function elementPosition(element, offseTop, offsetBottom) {
  let top = element.getBoundingClientRect().top;
  if (top - offseTop < 0) {
    return 'top';
  }
  if (top + element.offsetHeight + offsetBottom <= window.innerHeight) {
    return 'in';
  }
  return 'bottom';
}

@templateLayout(layout)
@classNames('sticky-element-container')
@attributeBindings('style')
export default class StickyElement extends Component {
  /**
   * The offset from the top of the viewport when to start sticking to the top
   *
   * @property top
   * @type {number}
   * @default 0
   * @public
   */
  top = 0;

  /**
   * The offset from the parents bottom edge when to start sticking to the bottom of the parent
   * When `null` (default) sticking to the bottom is disabled. Use 0 or any other appropriate offset to enable it.
   *
   * @property bottom
   * @type {boolean|null}
   * @public
   */
  bottom = null;

  /**
   * Set to false to disable sticky behavior
   *
   * @property enabled
   * @type {boolean}
   * @default true
   * @public
   */
  enabled = true;

  /**
   * The class name set on the element container.
   *
   * @property containerClassName
   * @type {string|null}
   * @default 'sticky-element'
   * @public
   */
  containerClassName = 'sticky-element';

  /**
   * The class name set on the element container when it is sticked.
   *
   * @property containerStickyClassName
   * @type {string|null}
   * @default 'sticky-element--sticky'
   * @public
   */
  containerStickyClassName = 'sticky-element--sticky';

  /**
   * The class name set on the element container when it is sticked to top.
   *
   * @property containerStickyTopClassName
   * @type {string|null}
   * @default 'sticky-element--sticky-top'
   * @public
   */
  containerStickyTopClassName = 'sticky-element--sticky-top';

  /**
   * The class name set on the element container when it is sticked to bottom.
   *
   * @property containerStickyBottomClassName
   * @type {string|null}
   * @default 'sticky-element--sticky-bottom'
   * @public
   */
  containerStickyBottomClassName = 'sticky-element--sticky-bottom';

  /**
   * @property isSticky
   * @type {boolean}
   * @readOnly
   * @private
   */
  @(or('isStickyTop', 'isStickyBottom').readOnly())
  isSticky;

  /**
   * @property isStickyTop
   * @type {boolean}
   * @readOnly
   * @private
   */
  @(
    computed('enabled', 'parentTop', 'parentBottom', 'isStickyBottom').readOnly()
  )
  get isStickyTop() {
    return this.get('enabled') && this.get('parentTop') === 'top' && !this.get('isStickyBottom');
  }

  /**
   * @property isStickyBottom
   * @type {boolean}
   * @readOnly
   * @private
   */
  @(computed('enabled', 'parentBottom', 'stickToBottom').readOnly())
  get isStickyBottom() {
    return this.get('enabled') && this.get('parentBottom') !== 'bottom' && this.get('stickToBottom');
  }

  /**
   * @property parentTop
   * @type {string}
   * @private
   */
  parentTop = 'bottom';

  /**
   * @property parentBottom
   * @type {string}
   * @private
   */
  parentBottom = 'bottom';

  /**
   * @property ownHeight
   * @type {number}
   * @private
   */
  ownHeight = 0;

  /**
   * @property ownWidth
   * @type {number}
   * @private
   */
  ownWidth = 0;

  /**
   * @property stickToBottom
   * @type {boolean}
   * @readOnly
   * @private
   */
  @(notEmpty('bottom').readOnly())
  stickToBottom;

  /**
   * @property windowHeight
   * @type {number}
   * @private
   */
  windowHeight = 0;

  /**
   * @property topTriggerElement
   * @private
   */
  topTriggerElement = null;

  /**
   * @property bottomTriggerElement
   * @private
   */
  bottomTriggerElement = null;

  /**
   * @property offsetBottom
   * @type {number}
   * @private
   */
  @computed('top', 'ownHeight', 'bottom', 'windowHeight')
  get offsetBottom() {
    let { top, ownHeight, bottom, windowHeight } = this.getProperties('top', 'ownHeight', 'bottom', 'windowHeight');
    return (windowHeight - top - ownHeight - bottom);
  }

  /**
   * Dynamic style for the components element
   *
   * @property style
   * @type {string}
   * @private
   */
  @computed('isSticky', 'ownHeight', 'ownWidth')
  get style() {
    let height = this.get('ownHeight');
    if (height > 0 && this.get('isSticky')) {
      return htmlSafe(`height: ${height}px;`);
    }
  }

  /**
   * Dynamic style for the sticky container (`position: fixed`)
   *
   * @property containerStyle
   * @type {string}
   * @private
   */
  @computed('isStickyTop', 'isStickyBottom', 'top', 'bottom', 'ownWidth')
  get containerStyle() {
    if (this.get('isStickyBottom')) {
      let style = `position: absolute; bottom: ${this.get('bottom')}px; width: ${this.get('ownWidth')}px`;
      return htmlSafe(style);
    }
    if (this.get('isStickyTop')) {
      let style = `position: fixed; top: ${this.get('top')}px; width: ${this.get('ownWidth')}px`;
      return htmlSafe(style);
    }
  }

  /**
   * Add listener to update sticky element width on resize event
   * @method initResizeEventListener
   * @private
   */
  initResizeEventListener() {
    this._resizeListener = () => this.debouncedUpdateDimension();
    window.addEventListener('resize', this._resizeListener, false);
  }

  /**
   * @method removeResizeEventListener
   * @private
   */
  removeResizeEventListener() {
    window.removeEventListener('resize', this._resizeListener, false);
  }

  _pollTask() {
    this.updatePosition();
    this.initPollTask();
  }

  initPollTask() {
    this._pollTimer = later(this, this._pollTask, 500);
  }

  removePollTask() {
    if (this._pollTimer) {
      cancel(this._pollTimer);
    }
  }

  /**
   * @method debouncedUpdateDimension
   * @private
   */
  debouncedUpdateDimension() {
    debounce(this, this.updateDimension, 30);
  }

  /**
   * @method updateDimension
   * @private
   */
  updateDimension() {
    if(this.get('isDestroyed') || this.get('isDestroying')) {
      return false;
    }
    this.set('windowHeight', window.innerHeight);
    this.set('ownHeight', this.element.offsetHeight);
    this.set('ownWidth', this.element.offsetWidth);
  }

  updatePosition() {
    let { topTriggerElement, bottomTriggerElement } = this;

    if (topTriggerElement) {
      this.set('parentTop', elementPosition(topTriggerElement, this.get('top'), 0));
    }
    if (bottomTriggerElement) {
      this.set('parentBottom', elementPosition(bottomTriggerElement, 0, this.get('offsetBottom')));
    }
  }

  didInsertElement() {
    super.didInsertElement(...arguments);
    this.updateDimension();
    // scheduleOnce('afterRender', this, this.updateDimension);
    this.initResizeEventListener();
    this.initPollTask();
  }

  willDestroyElement() {
    this.removeResizeEventListener();
    this.removePollTask();
  }

  @action
  parentTopEntered() {
    // console.log('parentTopEntered');
    this.set('parentTop', 'in');
  }

  @action
  parentTopExited() {
    // make sure we captured the right dimensions before getting sticky!
    // console.log('parentTopExited');
    this.updateDimension();
    this.updatePosition();
  }

  @action
  parentBottomEntered() {
    // console.log('parentBottomEntered');
    this.set('parentBottom', 'in');
  }

  @action
  parentBottomExited() {
    // console.log('parentBottomExited');
    this.updatePosition();
  }

  @action
  registerTopTrigger(element) {
    this.topTriggerElement = element;
    this.updatePosition();
  }

  @action
  registerBottomTrigger(element) {
    this.bottomTriggerElement = element;
    this.updatePosition();
  }
}
