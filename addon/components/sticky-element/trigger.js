import Component from '@ember/component';
import { observer, computed } from '@ember/object';
import { typeOf } from '@ember/utils';
import { assert, debug } from '@ember/debug';
import { inject } from '@ember/service';
import { set, get, setProperties } from '@ember/object';
import { bind, debounce, scheduleOnce } from '@ember/runloop';
import { not } from '@ember/object/computed';
import { getOwner } from '@ember/application';
import { startRAF } from 'ember-in-viewport/-private/raf-admin';
import canUseDOM from 'ember-in-viewport/utils/can-use-dom';
import canUseRAF from 'ember-in-viewport/utils/can-use-raf';
import findElem from 'ember-in-viewport/utils/find-elem';
import canUseIntersectionObserver from 'ember-in-viewport/utils/can-use-intersection-observer';
import checkScrollDirection from 'ember-in-viewport/utils/check-scroll-direction';

const lastDirection = {};
const lastPosition = {};

export default Component.extend({
  classNameBindings: ['typeClass'],
  classNames: ['sticky-element__trigger'],

  /**
   * @property type
   * @type {string}
   * @default 'top'
   * @public
   */
  type: 'top',

  /**
   * @property offset
   * @type {number}
   * @public
   */
  offset: 0,

  /**
   * @property typeClass
   * @type string
   * @private
   */
  typeClass: computed('type', function () {
    return `sticky-element__trigger--${this.get('type')}`;
  }),

  _lastTop: null,

  /**
   * Action when trigger enters viewport
   *
   * @event enter
   * @public
   */

  /**
   * Action when trigger exits viewport
   *
   * @event exit
   * @param {Boolean} top True if element left the viewport from the top
   * @public
   */

  isBeforeViewport() {
    let offset = this.get('type') === 'top' ? this.get('offset') : 0;
    return this.get('element').getBoundingClientRect().top - offset < 0;
  },

  didEnterViewport() {
    this.enter();
  },

  didExitViewport() {
    this.exit();
  },

  /**
   * @method updateViewportOptions
   * @private
   */
  updateViewportOptions() {
    let viewportTolerance = {
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
    };
    viewportTolerance[this.get('type')] = -this.get('offset');
    setProperties(this, {
      viewportSpy: true,
      viewportEnabled: true,
      viewportTolerance,
    });

    this.updateIntersectionObserver();
  },

  /**
   * Updates intersectionObserver after options have changed
   *
   * @method updateIntersectionObserver
   * @private
   */
  updateIntersectionObserver() {
    if (this.intersectionObserver) {
      this.intersectionObserver.unobserve(this.element);
      this._setViewportEntered();
    }
  },

  init() {
    this._super(...arguments);
    let options = Object.assign(
      {
        viewportUseRAF: canUseRAF(),
        viewportEntered: false,
        viewportListeners: [],
      },
      this._buildOptions()
    );

    // set viewportUseIntersectionObserver after merging users config to avoid errors in browsers that lack support (https://github.com/DockYard/ember-in-viewport/issues/146)
    options = Object.assign(options, {
      viewportUseIntersectionObserver: canUseIntersectionObserver(),
    });

    setProperties(this, options);
    set(this, '_evtListenerClosures', []);
    this.updateViewportOptions();
  },

  didInsertElement() {
    this._super(...arguments);
    if (canUseDOM) {
      const viewportEnabled = get(this, 'viewportEnabled');
      if (viewportEnabled) {
        this.watchElement(get(this, 'element'));
      }
    }
    this.registerElement(this.element);
  },

  _onOffsetChange: observer('offset', function () {
    scheduleOnce('afterRender', this, this.updateViewportOptions);
  }),

  _bindScrollDirectionListener() {},
  _unbindScrollDirectionListener() {},

  /**
   * Override ember-in-viewport method to trigger event also when trigger has moved from below viewport to on top
   * of viewport without triggering didEnterViewport because of too fast scroll movement
   *
   * @method _triggerDidAccessViewport
   * @param hasEnteredViewport
   * @private
   */
  _triggerDidAccessViewport(hasEnteredViewport = false) {
    let viewportEntered = this.get('viewportEntered');
    let didEnter = !viewportEntered && hasEnteredViewport;
    let didLeave = viewportEntered && !hasEnteredViewport;

    let lastTop = this._lastTop;
    this._lastTop = this.isBeforeViewport();

    if (!didEnter && !didLeave) {
      if (lastTop !== this._lastTop) {
        this._super(true);
        this._super(false);
      }
    } else {
      const isTearingDown = this.isDestroyed || this.isDestroying;
      if (isTearingDown) {
        return;
      }

      const didEnter = !viewportEntered && hasEnteredViewport;
      const didLeave = viewportEntered && !hasEnteredViewport;
      let triggeredEventName = '';

      if (didEnter) {
        triggeredEventName = 'didEnterViewport';
      }

      if (didLeave) {
        triggeredEventName = 'didExitViewport';
      }

      if (get(this, 'viewportSpy') || !viewportEntered) {
        set(this, 'viewportEntered', hasEnteredViewport);
      }

      if (triggeredEventName) {
        this.trigger(triggeredEventName);
      }
    }
  },

  /**
   * @property _debouncedEventHandler
   * @default null
   */
  _debouncedEventHandler: null,

  /**
   * unbinding listeners will short circuit rAF
   *
   * @property _stopListening
   * @default false
   */
  _stopListening: false,

  inViewport: inject(),

  /**
   * @property viewportExited
   * @type Boolean
   */
  viewportExited: not('viewportEntered').readOnly(),

  willDestroyElement() {
    this._super(...arguments);

    this._unbindListeners(get(this, 'element'));
  },

  _buildOptions(defaultOptions = {}) {
    const owner = getOwner(this);

    if (owner) {
      return Object.assign(defaultOptions, owner.lookup('config:in-viewport'));
    }
  },

  watchElement(element) {
    this._setInitialViewport(element);
    this._addObserverIfNotSpying(element);

    const viewportDidScroll = get(this, 'viewportDidScroll');
    if (viewportDidScroll) {
      debug(
        '[viewportDidScroll] This will be false by default in the next major release'
      );
      this._bindScrollDirectionListener(get(this, 'viewportScrollSensitivity'));
    }

    if (
      !get(this, 'viewportUseIntersectionObserver') &&
      !get(this, 'viewportUseRAF')
    ) {
      get(this, 'viewportListeners').forEach((listener) => {
        let { context, event } = listener;
        context = get(this, 'scrollableArea') || context;
        this._bindListeners(context, event, element);
      });
    }
  },

  _addObserverIfNotSpying(element) {
    if (!get(this, 'viewportSpy')) {
      this.addObserver(
        'viewportEntered',
        this,
        bind(this, '_unbindIfEntered', element)
      );
    }
  },

  _setInitialViewport(element) {
    const isTearingDown = this.isDestroyed || this.isDestroying;
    if (!element || isTearingDown) {
      return;
    }

    const inViewport = get(this, 'inViewport');

    if (get(this, 'viewportUseIntersectionObserver')) {
      return scheduleOnce('afterRender', this, () => {
        const scrollableArea = get(this, 'scrollableArea');
        const viewportTolerance = get(this, 'viewportTolerance');
        const intersectionThreshold = get(this, 'intersectionThreshold');

        inViewport.watchElement(
          element,
          { intersectionThreshold, viewportTolerance, scrollableArea },
          bind(this, this._onEnterIntersection),
          bind(this, this._onExitIntersection)
        );
      });
    } else if (get(this, 'viewportUseRAF')) {
      inViewport.startRAF();

      const scrollableArea = get(this, 'scrollableArea');
      const viewportTolerance = get(this, 'viewportTolerance');
      const viewportSpy = get(this, 'viewportSpy');

      const enterCallback = () => {
        const isTearingDown = this.isDestroyed || this.isDestroying;
        const viewportEntered =
          element.getAttribute('data-in-viewport-entered') === 'true';
        if (!isTearingDown && (viewportSpy || viewportEntered)) {
          set(this, 'viewportEntered', true);
          this.trigger('didEnterViewport');
        }
      };
      const exitCallback = () => {
        const isTearingDown = this.isDestroyed || this.isDestroying;
        if (!isTearingDown && viewportSpy) {
          set(this, 'viewportEntered', false);
          this.trigger('didExitViewport');
        }
      };

      startRAF(
        element,
        { scrollableArea, viewportTolerance, viewportSpy },
        enterCallback,
        exitCallback,
        inViewport.addRAF.bind(inViewport, element.id),
        inViewport.removeRAF.bind(inViewport, element.id)
      );
    } else {
      return scheduleOnce('afterRender', this, () => {
        this._setViewportEntered(element);
      });
    }
  },

  /**
   * used by rAF and scroll event listeners to determine if mixin is in viewport
   * Remember to set `viewportSpy` to true if you want to continuously observe your element
   *
   * @method _setViewportEntered
   */
  _setViewportEntered(element) {
    const scrollableArea = get(this, 'scrollableArea')
      ? document.querySelector(get(this, 'scrollableArea'))
      : undefined;

    const height = scrollableArea
      ? scrollableArea.offsetHeight + scrollableArea.getBoundingClientRect().top
      : window.innerHeight;
    const width = scrollableArea
      ? scrollableArea.offsetWidth + scrollableArea.getBoundingClientRect().left
      : window.innerWidth;
    const boundingClientRect = element.getBoundingClientRect();

    if (boundingClientRect) {
      this._triggerDidAccessViewport(
        get(this, 'inViewport').isInViewport(
          boundingClientRect,
          height,
          width,
          get(this, 'viewportTolerance')
        ),
        get(this, 'viewportEntered')
      );

      if (get(this, 'viewportUseRAF') && !get(this, '_stopListening')) {
        get(this, 'inViewport').addRAF(
          get(this, 'elementId'),
          bind(this, this._setViewportEntered, element)
        );
      }
    }
  },

  /**
   * Callback provided to IntersectionObserver
   * trigger didEnterViewport callback
   *
   * @method _onEnterIntersection
   */
  _onEnterIntersection() {
    const isTearingDown = this.isDestroyed || this.isDestroying;

    if (!isTearingDown) {
      set(this, 'viewportEntered', true);
    }

    this.trigger('didEnterViewport');
  },

  /**
   * trigger didExitViewport callback
   *
   * @method _onExitIntersection
   */
  _onExitIntersection() {
    const isTearingDown = this.isDestroyed || this.isDestroying;

    if (!isTearingDown) {
      set(this, 'viewportEntered', false);
    }

    this.trigger('didExitViewport');
  },

  /**
   * @method _triggerDidScrollDirection
   * @param contextEl
   * @param sensitivity
   */
  _triggerDidScrollDirection(contextEl = null, sensitivity = 1) {
    assert(
      'You must pass a valid context element to _triggerDidScrollDirection',
      contextEl
    );
    assert('sensitivity cannot be 0', sensitivity);

    const elementId = get(this, 'elementId');
    const lastDirectionForEl = lastDirection[elementId];
    const lastPositionForEl = lastPosition[elementId];
    const newPosition = {
      top: contextEl.scrollTop,
      left: contextEl.scrollLeft,
    };

    const scrollDirection = checkScrollDirection(
      lastPositionForEl,
      newPosition,
      sensitivity
    );
    const directionChanged = scrollDirection !== lastDirectionForEl;

    if (scrollDirection && directionChanged && get(this, 'viewportDidScroll')) {
      this.trigger('didScroll', scrollDirection);
      lastDirection[elementId] = scrollDirection;
    }

    lastPosition[elementId] = newPosition;
  },

  /**
   * Unbind when enter viewport only if viewportSpy is false
   *
   * @method _unbindIfEntered
   */
  _unbindIfEntered(element) {
    if (get(this, 'viewportEntered')) {
      this._unbindListeners(element);
      this.removeObserver('viewportEntered', this, '_unbindIfEntered');
      set(this, 'viewportEntered', false);
    }
  },

  /**
   * General utility function
   *
   * @method _debouncedEvent
   */
  _debouncedEvent(methodName, ...args) {
    assert('You must pass a methodName to _debouncedEvent', methodName);
    assert('methodName must be a string', typeOf(methodName) === 'string');

    debounce(
      this,
      () => this[methodName](...args),
      get(this, 'viewportRefreshRate')
    );
  },

  /**
   * Only if not using IntersectionObserver and rAF
   *
   * @method _bindListeners
   */
  _bindListeners(context = null, event = null, element = null) {
    assert('You must pass a valid context to _bindListeners', context);
    assert('You must pass a valid event to _bindListeners', event);

    let elem = findElem(context);

    let evtListener = () =>
      this._debouncedEvent('_setViewportEntered', element);
    this._evtListenerClosures.push({ event: event, evtListener });
    elem.addEventListener(event, evtListener, false);
  },

  /**
   * Remove listeners for rAF or scroll event listeners
   * Either from component destroy or viewport entered and
   * need to turn off listening
   *
   * @method _unbindListeners
   */
  _unbindListeners(element) {
    set(this, '_stopListening', true);

    // if IntersectionObserver
    if (
      get(this, 'viewportUseIntersectionObserver') &&
      get(this, 'viewportEnabled')
    ) {
      get(this, 'inViewport').unobserveIntersectionObserver(element);
    }

    // if rAF
    if (
      !get(this, 'viewportUseIntersectionObserver') &&
      get(this, 'viewportUseRAF')
    ) {
      const elementId = get(this, 'elementId');

      get(this, 'inViewport').removeRAF(elementId);
    }

    // if scroll event listeners
    if (
      !get(this, 'viewportUseIntersectionObserver') &&
      !get(this, 'viewportUseRAF')
    ) {
      get(this, 'viewportListeners').forEach((listener) => {
        let { context, event } = listener;
        context = get(this, 'scrollableArea') || context;
        let elem = findElem(context);
        let { evtListener } =
          this._evtListenerClosures.find(
            (closure) => event === closure.event
          ) || {};

        elem.removeEventListener(event, evtListener, false);
      });
    }

    // 4. last but not least
    const viewportDidScroll = get(this, 'viewportDidScroll');
    if (viewportDidScroll) {
      this._unbindScrollDirectionListener();
    }
  },
});
